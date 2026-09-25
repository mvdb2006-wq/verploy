import { afterAll, describe, expect, it } from 'vitest'
import { actAs, asSuper, expectError, inTx, pool, seedAgency, type Db } from './helpers'

afterAll(() => pool.end())

/** Gekoppelde site (connector 2.2.0) met een Akismet-update naar 5.3. */
async function setup(db: Db, opts: { on?: boolean } = {}) {
  const a = await seedAgency(db, 'sched')
  const site = a.siteIds[1]!
  await asSuper(db)
  await db.query(`update public.sites set connection_status = 'connected', paired_at = now(), connector_version = '2.2.0',
                  last_heartbeat_at = now() where id = $1`, [site])
  await db.query(`update public.site_components set latest_version = '5.3', update_available = true where site_id = $1`, [site])
  if (opts.on) await db.query(`update public.agencies set auto_updates = true where id = $1`, [a.id])
  return { a, site }
}

async function asWorker<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await actAs(db, { role: 'service_role' })
  try { return await fn() } finally { await asSuper(db) }
}
const candidates = (db: Db) => asWorker(db, async () => (await db.query(`select * from public.scheduled_update_candidates(5000)`)).rows)
const start = (db: Db, site: string, items: unknown[] = [{ type: 'plugin', slug: 'akismet/akismet.php' }]) =>
  asWorker(db, async () => (await db.query(`select public.start_scheduled_update($1, $2) id`, [site, JSON.stringify(items)])).rows[0].id as string | null)
const approvals = (db: Db, site: string, items: unknown[]) =>
  asWorker(db, () => db.query(`select public.sync_update_approvals($1, $2)`, [site, JSON.stringify(items)]))

describe('geplande veilige updates', () => {
  it('standaard uit: bestaande bureaus en sites veranderen niets', () =>
    inTx(async db => {
      const { a, site } = await setup(db)
      const r = await db.query(`select auto_updates, auto_update_window, auto_update_frequency, timezone from public.agencies where id = $1`, [a.id])
      expect(r.rows[0]).toEqual({ auto_updates: false, auto_update_window: 'night', auto_update_frequency: 'daily', timezone: 'Europe/Amsterdam' })
      expect((await candidates(db)).map(c => c.site_id)).not.toContain(site)
      expect(await start(db, site)).toBeNull()
    }))

  it('aan: site is kandidaat; "nooit automatisch" per site sluit hem uit', () =>
    inTx(async db => {
      const { site } = await setup(db, { on: true })
      const c = (await candidates(db)).find(x => x.site_id === site)
      expect(c).toMatchObject({ timezone: 'Europe/Amsterdam', update_window: 'night', frequency: 'daily', last_scheduled_at: null, busy: false })
      await db.query(`update public.sites set auto_updates = false where id = $1`, [site])
      expect((await candidates(db)).map(x => x.site_id)).not.toContain(site)
      expect(await start(db, site)).toBeNull()
    }))

  it('start een run door Verploy (trigger scheduled, zonder gebruiker); daarna "busy" en laatste moment bekend', () =>
    inTx(async db => {
      const { site } = await setup(db, { on: true })
      const id = await start(db, site)
      expect(id).toMatch(/^[0-9a-f-]{36}$/)
      const r = await db.query(`select trigger, created_by, items->0->>'to_version' v from public.update_runs where id = $1`, [id])
      expect(r.rows[0]).toEqual({ trigger: 'scheduled', created_by: null, v: '5.3' })
      const ev = await db.query(`select message_key from public.update_run_events where run_id = $1`, [id])
      expect(ev.rows[0].message_key).toBe('run.queued_scheduled')
      const c = (await candidates(db)).find(x => x.site_id === site)
      expect(c.busy).toBe(true)
      expect(c.last_scheduled_at).not.toBeNull()
      expect(await start(db, site)).toBeNull()                                  // er loopt al iets
    }))

  it('geen update beschikbaar of alleen-lezen bureau → geen run, geen fout', () =>
    inTx(async db => {
      const { a, site } = await setup(db, { on: true })
      expect(await start(db, site, [{ type: 'plugin', slug: 'bestaat-niet/x.php' }])).toBeNull()
      await db.query(`update public.agencies set plan_status = 'canceled' where id = $1`, [a.id])
      expect(await start(db, site)).toBeNull()
      expect((await candidates(db)).map(x => x.site_id)).not.toContain(site)
    }))

  it('vraag om akkoord: één per site, bijgewerkt, en vervalt bij een lege lijst of als het bureau het uitzet', () =>
    inTx(async db => {
      const { a, site } = await setup(db, { on: true })
      const item = { type: 'plugin', slug: 'akismet/akismet.php', name: 'Akismet', from_version: '4.2', to_version: '5.3', why: 'major' }
      await approvals(db, site, [item])
      await approvals(db, site, [item])
      let al = await db.query(`select severity, status, params from public.alerts where site_id = $1 and type = 'update_approval'`, [site])
      expect(al.rows).toEqual([{ severity: 'warning', status: 'open', params: { count: 1, items: [item] } }])
      await approvals(db, site, [])
      al = await db.query(`select status from public.alerts where site_id = $1 and type = 'update_approval'`, [site])
      expect(al.rows).toEqual([{ status: 'resolved' }])

      await approvals(db, site, [item])
      await db.query(`update public.agencies set auto_updates = false where id = $1`, [a.id])
      const n = await asWorker(db, async () => (await db.query(`select public.clear_update_approvals_outside_schedule() n`)).rows[0].n)
      expect(n).toBe(1)
      al = await db.query(`select count(*)::int n from public.alerts where site_id = $1 and type = 'update_approval' and status = 'open'`, [site])
      expect(al.rows[0].n).toBe(0)
    }))

  it('instellingen: eigenaar/beheerder mogen ze wijzigen, lid niet; ongeldige waarden geweigerd', () =>
    inTx(async db => {
      const { a, site } = await setup(db)
      await actAs(db, { role: 'authenticated', ...a.member })
      expect((await db.query(`update public.agencies set auto_updates = true where id = $1`, [a.id])).rowCount).toBe(0)
      await actAs(db, { role: 'authenticated', ...a.admin })
      expect((await db.query(`update public.agencies set auto_updates = true, auto_update_window = 'evening', auto_update_frequency = 'weekly', timezone = 'America/New_York' where id = $1`, [a.id])).rowCount).toBe(1)
      expect((await expectError(db, `update public.agencies set auto_update_window = 'lunch' where id = '${a.id}'`)).code).toBe('23514')
      expect((await expectError(db, `update public.agencies set timezone = 'x; drop table' where id = '${a.id}'`)).code).toBe('23514')
      expect((await db.query(`update public.sites set auto_updates = false where id = $1`, [site])).rowCount).toBe(1)
    }))

  it('RPC\'s zijn alleen voor de worker', () =>
    inTx(async db => {
      const { a, site } = await setup(db, { on: true })
      await actAs(db, { role: 'authenticated', ...a.owner })
      for (const sql of [
        `select * from public.scheduled_update_candidates(1)`,
        `select public.start_scheduled_update('${site}', '[]')`,
        `select public.sync_update_approvals('${site}', '[]')`,
        `select public.clear_update_approvals_outside_schedule()`,
      ]) expect((await expectError(db, sql)).code).toBe('42501')
    }))
})
