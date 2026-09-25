import { afterAll, describe, expect, it } from 'vitest'
import { actAs, asSuper, expectError, inTx, pool, seedAgency, type Db } from './helpers'

afterAll(() => pool.end())

async function site(db: Db, version: string, opts: { status?: string } = {}) {
  const a = await seedAgency(db, `roll-${version.replace(/\./g, '')}`)
  await asSuper(db)
  await db.query(`update public.sites set connection_status = $2, paired_at = now(), connector_version = $3, last_heartbeat_at = now() where id = $1`,
    [a.siteIds[0], opts.status ?? 'connected', version])
  return { a, id: a.siteIds[0]! }
}
async function rollout(db: Db, version = '2.6.0') {
  await actAs(db, { role: 'service_role' })
  try { return (await db.query(`select public.start_connector_updates($1) n`, [version])).rows[0].n as number } finally { await asSuper(db) }
}
const runs = async (db: Db, id: string) =>
  (await db.query(`select trigger, items->0->>'slug' slug, items->0->>'from_version' f, items->0->>'to_version' t from public.update_runs where site_id = $1 and trigger = 'connector'`, [id])).rows

describe('nieuwe Verploy Connector uitrollen', () => {
  it('start één veilige update (trigger connector) op sites met 2.5.3+ die achterlopen', () =>
    inTx(async db => {
      const behind = await site(db, '2.5.3')
      const current = await site(db, '2.6.0')
      const old = await site(db, '2.5.0')            // kan nog niet meteen kijken: gaat via de gewone nachtelijke updates
      const loose = await site(db, '2.5.3', { status: 'awaiting_pairing' })
      expect(await rollout(db)).toBeGreaterThanOrEqual(1)
      expect(await runs(db, behind.id)).toEqual([{ trigger: 'connector', slug: 'verploy-connector/verploy-connector.php', f: '2.5.3', t: '2.6.0' }])
      for (const s of [current, old, loose]) expect(await runs(db, s.id)).toEqual([])
      const ev = await db.query(`select message_key, params->>'version' v from public.update_run_events e join public.update_runs r on r.id = e.run_id where r.site_id = $1 and r.trigger = 'connector'`, [behind.id])
      expect(ev.rows).toEqual([{ message_key: 'run.queued_connector', v: '2.6.0' }])
    }))

  it('niet als er al iets loopt, niet vaker dan eens per 6 uur, hooguit 3 keer per versie', () =>
    inTx(async db => {
      const s = await site(db, '2.5.3')
      await rollout(db)
      await rollout(db)                                                      // loopt al
      expect(await runs(db, s.id)).toHaveLength(1)
      await db.query(`update public.update_runs set status = 'done', verdict = 'blocked', finished_at = now() where site_id = $1 and trigger = 'connector'`, [s.id])
      await rollout(db)                                                      // binnen 6 uur: niet opnieuw
      expect(await runs(db, s.id)).toHaveLength(1)
      await db.query(`update public.update_runs set created_at = now() - interval '7 hours' where site_id = $1 and trigger = 'connector'`, [s.id])
      await rollout(db)
      expect(await runs(db, s.id)).toHaveLength(2)
      await db.query(`update public.update_runs set status = 'done', verdict = 'blocked', finished_at = now(), created_at = now() - interval '7 hours' where site_id = $1 and trigger = 'connector'`, [s.id])
      await rollout(db)
      await db.query(`update public.update_runs set status = 'done', verdict = 'blocked', finished_at = now(), created_at = now() - interval '7 hours' where site_id = $1 and trigger = 'connector'`, [s.id])
      await rollout(db)
      expect(await runs(db, s.id)).toHaveLength(3)                          // maximum bereikt
    }))

  it('alleen-lezen bureau en ongeldige versie; alleen de worker mag het', () =>
    inTx(async db => {
      const s = await site(db, '2.5.3')
      await db.query(`update public.agencies set plan_status = 'canceled' where id = $1`, [s.a.id])
      await rollout(db)
      expect(await runs(db, s.id)).toEqual([])
      await actAs(db, { role: 'service_role' })
      expect((await expectError(db, `select public.start_connector_updates('nope')`)).message).toMatch(/invalid_version/)
      await actAs(db, { role: 'authenticated', ...s.a.owner })
      expect((await expectError(db, `select public.start_connector_updates('2.6.0')`)).message).toMatch(/permission denied/)
    }))
})
