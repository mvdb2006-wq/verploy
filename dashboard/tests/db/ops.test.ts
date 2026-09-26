import { afterAll, describe, expect, it } from 'vitest'
import { actAs, asSuper, expectError, inTx, pool, seedAgency, type Db } from './helpers'

afterAll(() => pool.end())

async function problems(db: Db): Promise<Record<string, string>> {
  await actAs(db, { role: 'service_role' })
  try {
    const { rows } = await db.query<{ key: string; detail: string }>(`select key, detail from public.ops_problems()`)
    return Object.fromEntries(rows.map(r => [r.key, r.detail]))
  } finally { await asSuper(db) }
}

describe('alarm voor de beheerder (ops_problems)', () => {
  it('worker zonder levensteken, vastgelopen runs, stille heartbeats en recente fouten', () =>
    inTx(async db => {
      await db.query(`delete from public.ops_heartbeats; delete from public.ops_events; update public.sites set connection_status = 'revoked'`)
      expect(Object.keys(await problems(db))).toEqual(['worker_down'])
      await db.query(`insert into public.ops_heartbeats (worker_id, seen_at) values ('w1', now() - interval '3 minutes')`)
      expect(await problems(db)).toEqual({})

      const a = await seedAgency(db, 'ops')
      await db.query(`update public.sites set connection_status = 'connected', last_heartbeat_at = now() - interval '2 hours' where agency_id = $1`, [a.id])
      await db.query(`insert into public.update_runs (agency_id, site_id, items, not_before) values ($1, $2, '[{"type":"plugin","slug":"a/a.php"}]', now() - interval '40 minutes')`, [a.id, a.siteIds[0]])
      await db.query(`insert into public.ops_events (source, kind, detail) values ('stripe', 'webhook_failed', 'eerste'), ('stripe', 'webhook_failed', 'laatste'), ('worker', 'claim_failed', 'oud')`)
      await db.query(`update public.ops_events set created_at = now() - interval '1 hour' where kind = 'claim_failed'`)
      const p = await problems(db)
      expect(Object.keys(p).sort()).toEqual(['error:stripe:webhook_failed', 'heartbeats_silent', 'runs_stuck'])
      expect(p['error:stripe:webhook_failed']).toBe('2× in 15 min. Laatste: laatste')
      expect(p.runs_stuck).toMatch(/^1 update\(s\) komen niet verder/)
    }))

  it('klanten en anonieme bezoekers kunnen er niet bij', () =>
    inTx(async db => {
      const a = await seedAgency(db, 'ops-rls')
      await actAs(db, { role: 'authenticated', id: a.owner.id, email: a.owner.email })
      expect((await expectError(db, `select * from public.ops_problems()`)).code).toBe('42501')
      expect((await expectError(db, `select cron_token from public.ops_config`)).code).toBe('42501')
    }))
})

describe('bureau verwijderen', () => {
  it('alleen de eigenaar, met de juiste naam, niet tijdens een update; alles weg en bestanden in de wachtrij', () =>
    inTx(async db => {
      const a = await seedAgency(db, 'weg')
      const run = (await db.query(`insert into public.update_runs (agency_id, site_id, items) values ($1, $2, '[{"type":"plugin","slug":"a/a.php"}]') returning id`, [a.id, a.siteIds[0]])).rows[0].id as string
      await actAs(db, { role: 'authenticated', id: a.admin.id, email: a.admin.email })
      expect((await expectError(db, `select * from public.delete_agency($1)`, ['Bureau weg'])).message).toMatch(/forbidden/)
      await actAs(db, { role: 'authenticated', id: a.owner.id, email: a.owner.email })
      expect((await expectError(db, `select * from public.delete_agency($1)`, ['bureau weg'])).message).toMatch(/confirm_mismatch/)
      expect((await expectError(db, `select * from public.delete_agency($1)`, ['Bureau weg'])).message).toMatch(/run_active/)
      await asSuper(db)
      await db.query(`update public.update_runs set status = 'done', verdict = 'deployed', finished_at = now() where id = $1`, [run])
      await db.query(`delete from public.storage_purges`)

      await actAs(db, { role: 'authenticated', id: a.owner.id, email: a.owner.email })
      const users = (await db.query(`select user_id from public.delete_agency($1)`, [' Bureau weg '])).rows.map(r => r.user_id).sort()
      expect(users).toEqual([a.owner.id, a.admin.id, a.member.id].sort())
      await asSuper(db)
      for (const table of ['agencies', 'sites', 'update_runs', 'site_components', 'health_snapshots', 'agency_members']) {
        const col = table === 'agencies' ? 'id' : 'agency_id'
        expect((await db.query(`select count(*)::int n from public.${table} where ${col} = $1`, [a.id])).rows[0].n, table).toBe(0)
      }
      const purges = (await db.query(`select bucket, prefix from public.storage_purges order by bucket, prefix`)).rows
      for (const p of [
        { bucket: 'branding', prefix: a.id },
        { bucket: 'reports', prefix: a.id },
        { bucket: 'run-artifacts', prefix: a.id },
        { bucket: 'run-artifacts', prefix: `${a.id}/${run}` },
      ]) expect(purges).toContainEqual(p)
      expect(purges.every(p => p.prefix.startsWith(a.id))).toBe(true)
    }))

  it('site verwijderen zet ook de screenshots van die runs in de wachtrij', () =>
    inTx(async db => {
      const a = await seedAgency(db, 'site-weg')
      const run = (await db.query(`insert into public.update_runs (agency_id, site_id, items, status, verdict, finished_at) values ($1, $2, '[{"type":"plugin","slug":"a/a.php"}]', 'done', 'blocked', now()) returning id`, [a.id, a.siteIds[0]])).rows[0].id as string
      await db.query(`delete from public.storage_purges`)
      await db.query(`delete from public.sites where id = $1`, [a.siteIds[0]])
      const rows = (await db.query(`select bucket, prefix from public.storage_purges`)).rows
      expect(rows).toContainEqual({ bucket: 'run-artifacts', prefix: `${a.id}/${run}` })
      expect(rows.every(r => r.bucket === 'run-artifacts')).toBe(true)
    }))
})
