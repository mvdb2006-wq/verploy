import { afterAll, describe, expect, it } from 'vitest'
import { actAs, asSuper, expectError, inTx, pool, seedAgency, type Db } from './helpers'

afterAll(() => pool.end())

async function asWorker<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await actAs(db, { role: 'service_role' })
  try { return await fn() } finally { await asSuper(db) }
}

describe('request_report', () => {
  it('elk lid kan een rapport maken; versturen naar de klant alleen eigenaar/beheerder', () =>
    inTx(async db => {
      const a = await seedAgency(db, 'rep')
      const site = a.siteIds[1]!
      await db.query(`update public.sites set client_email = 'klant@example.test', report_locale = 'de' where id = $1`, [site])
      await actAs(db, { role: 'authenticated', ...a.member })
      const { rows: [r] } = await db.query(`select public.request_report($1, '2026-08-01', '2026-08-31') as id`, [site])
      expect((await expectError(db, `select public.request_report($1, '2026-08-01', '2026-08-31', true)`, [site])).code).toBe('42501')
      await actAs(db, { role: 'authenticated', ...a.admin })
      const { rows: [s] } = await db.query(`select public.request_report($1, '2026-08-01', '2026-08-31', true) as id`, [site])
      await asSuper(db)
      const rows = await db.query(`select id, trigger, locale, send_to, status from public.reports where id = any($1) order by send_to nulls first`, [[r.id, s.id]])
      expect(rows.rows.map(x => [x.trigger, x.locale, x.send_to, x.status])).toEqual([['manual', 'de', null, 'queued'], ['manual', 'de', 'klant@example.test', 'queued']])
    }))

  it('ongeldige periode, geen klantadres, ander bureau, gebruikers schrijven niet direct', () =>
    inTx(async db => {
      const a = await seedAgency(db, 'a')
      const b = await seedAgency(db, 'b')
      await actAs(db, { role: 'authenticated', ...a.owner })
      expect((await expectError(db, `select public.request_report($1, '2026-08-31', '2026-08-01')`, [a.siteIds[0]])).message).toBe('invalid_period')
      expect((await expectError(db, `select public.request_report($1, '2026-08-01', (current_date + 1))`, [a.siteIds[0]])).message).toBe('invalid_period')
      expect((await expectError(db, `select public.request_report($1, '2026-08-01', '2026-08-31', true)`, [a.siteIds[0]])).message).toBe('no_client_email')
      expect((await expectError(db, `select public.request_report($1, '2026-08-01', '2026-08-31')`, [b.siteIds[0]])).code).toBe('42501')
      expect((await expectError(db, `update public.reports set status = 'sent' where agency_id = $1`, [a.id])).code).toBe('42501')
      expect((await expectError(db, `insert into public.reports (agency_id, site_id, trigger, period_start, period_end, locale) values ($1, $2, 'manual', '2026-08-01', '2026-08-31', 'nl')`, [a.id, a.siteIds[0]])).code).toBe('42501')
    }))
})

describe('maandrapporten en wachtrij', () => {
  it('planner maakt per site met maandrapport één rapport over de vorige maand, ook bij herhalen', () =>
    inTx(async db => {
      const a = await seedAgency(db, 'maand')
      await db.query(`update public.sites set report_monthly = true, connection_status = 'connected', paired_at = now() - interval '90 days', client_email = 'k@example.test' where id = $1`, [a.siteIds[0]])
      const first = await asWorker(db, () => db.query(`select public.schedule_monthly_reports() as n`))
      const again = await asWorker(db, () => db.query(`select public.schedule_monthly_reports() as n`))
      expect(first.rows[0].n).toBeGreaterThanOrEqual(1)
      expect(again.rows[0].n).toBe(0)
      const r = await db.query(`select period_start, period_end, send_to from public.reports where site_id = $1 and trigger = 'monthly'`, [a.siteIds[0]])
      expect(r.rows).toHaveLength(1)
      const exp = await db.query(`select (date_trunc('month', (now() at time zone 'Europe/Amsterdam')::date) - interval '1 month')::date as s,
                                         (date_trunc('month', (now() at time zone 'Europe/Amsterdam')::date) - interval '1 day')::date as e`)
      expect([r.rows[0].period_start, r.rows[0].period_end]).toEqual([exp.rows[0].s, exp.rows[0].e])
      expect(r.rows[0].send_to).toBe('k@example.test')
    }))

  it('claim/complete: één worker tegelijk, lease, max. 3 pogingen', () =>
    inTx(async db => {
      const a = await seedAgency(db, 'q')
      await actAs(db, { role: 'authenticated', ...a.owner })
      const { rows: [r] } = await db.query(`select public.request_report($1, '2026-08-01', '2026-08-31') as id`, [a.siteIds[0]])
      await asSuper(db)
      const c1 = await asWorker(db, () => db.query(`select id, attempt, status from public.claim_report('w1', 60)`))
      expect(c1.rows.find(x => x.id === r.id)).toEqual({ id: r.id, attempt: 1, status: 'generating' })
      expect((await asWorker(db, () => db.query(`select id from public.claim_report('w2', 60)`))).rows.filter(x => x.id === r.id)).toHaveLength(0)
      await actAs(db, { role: 'service_role' })
      expect((await expectError(db, `select public.complete_report($1, 'w2', 'ready')`, [r.id])).message).toBe('lease_lost')
      await db.query(`select public.complete_report($1, 'w1', 'queued', null, null, 'tijdelijk')`, [r.id])
      await db.query(`select * from public.claim_report('w1', 60)`)
      await db.query(`select public.complete_report($1, 'w1', 'queued', null, null, 'tijdelijk')`, [r.id])
      await db.query(`select * from public.claim_report('w1', 60)`)
      await db.query(`select public.complete_report($1, 'w1', 'queued', null, null, 'tijdelijk')`, [r.id])
      const none = await db.query(`select id from public.claim_report('w1', 60)`)
      expect(none.rows.filter(x => x.id === r.id)).toHaveLength(0)   // na 3 pogingen niet meer
      await asSuper(db)
    }))

  it('RPC’s niet aanroepbaar voor gebruikers', () =>
    inTx(async db => {
      await actAs(db, { role: 'authenticated', id: '99999999-9999-4999-8999-999999999999', email: 'x@example.test' })
      for (const fn of [`schedule_monthly_reports()`, `claim_report('w', 60)`, `complete_report(gen_random_uuid(), 'w', 'ready')`]) {
        expect((await expectError(db, `select public.${fn}`)).code, fn).toBe('42501')
      }
    }))
})
