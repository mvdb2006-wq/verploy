import { afterAll, describe, expect, it } from 'vitest'
import { actAs, asSuper, expectError, inTx, pool, seedAgency, type Db } from './helpers'

afterAll(() => pool.end())

type Alert = { type: string; severity: string; status: string; params: Record<string, unknown>; notified_at: string | null }

async function connectedSite(db: Db, label = 'mon') {
  const a = await seedAgency(db, label)
  const site = a.siteIds[0]!
  await asSuper(db)
  await db.query(`update public.sites set connection_status = 'connected', paired_at = now() where id = $1`, [site])
  return { a, site }
}

async function heartbeat(db: Db, site: string, snapshot: Record<string, unknown> = {}, components: unknown[] = []) {
  await actAs(db, { role: 'service_role' })
  await db.query(`select public.ingest_heartbeat($1, $2, $3)`, [site,
    { connector_version: '2.0.0', wp_version: '7.1.2', php_version: '8.4.12', memory_limit_mb: 256, disk_free_mb: 20000, ...snapshot },
    JSON.stringify(components)])
  await asSuper(db)
}

async function openAlerts(db: Db, site: string): Promise<Record<string, Alert>> {
  await asSuper(db)
  const r = await db.query<Alert>(`select type, severity, status, params, notified_at from public.alerts where site_id = $1 and status = 'open'`, [site])
  return Object.fromEntries(r.rows.map(x => [x.type, x]))
}

async function sweep(db: Db) {
  await actAs(db, { role: 'service_role' })
  await db.query(`select public.sweep_alerts()`)
  await asSuper(db)
}

describe('Drempels: offline', () => {
  it('geen heartbeat > 45 min → kritieke melding + site offline; heartbeat → opgelost', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await heartbeat(db, site)
      expect(await openAlerts(db, site)).toEqual({})
      await db.query(`update public.sites set last_heartbeat_at = now() - interval '50 minutes' where id = $1`, [site])
      await sweep(db)
      const open = await openAlerts(db, site)
      expect(open.site_offline).toMatchObject({ severity: 'critical', status: 'open' })
      expect((await db.query(`select status from public.sites where id = $1`, [site])).rows[0].status).toBe('offline')
      await sweep(db)   // idempotent: nog steeds één melding
      expect((await db.query(`select count(*)::int n from public.alerts where site_id = $1 and type = 'site_offline'`, [site])).rows[0].n).toBe(1)
      await heartbeat(db, site)
      expect((await openAlerts(db, site)).site_offline).toBeUndefined()
      expect((await db.query(`select status from public.sites where id = $1`, [site])).rows[0].status).toBe('online')
    }))

  it('net gekoppeld zonder heartbeat is niet meteen offline', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await sweep(db)
      expect((await openAlerts(db, site)).site_offline).toBeUndefined()
    }))

  it('ontkoppelde site: alle open meldingen worden opgelost', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await heartbeat(db, site, { php_version: '7.4.33' })
      expect((await openAlerts(db, site)).php_eol).toBeDefined()
      await db.query(`update public.sites set connection_status = 'revoked' where id = $1`, [site])
      await sweep(db)
      expect(await openAlerts(db, site)).toEqual({})
    }))
})

describe('Drempels: SSL en domein', () => {
  const check = (db: Db, site: string, v: { valid: boolean | null; expiresInDays?: number; error?: string | null; domainDays?: number | null; domainError?: string | null }) =>
    actAs(db, { role: 'service_role' }).then(() => db.query(
      `select public.record_site_checks($1, $2, now() + make_interval(days => $3::int), 'Test CA', $4,
         case when $5::int is null then null else now() + make_interval(days => $5::int) end, $6, true)`,
      [site, v.valid, v.expiresInDays ?? 90, v.error ?? null, v.domainDays ?? null, v.domainError ?? null]))

  it('SSL verloopt < 14 d → waarschuwing; < 3 d → kritiek (escalatie meldt opnieuw)', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await heartbeat(db, site)
      await check(db, site, { valid: true, expiresInDays: 10 })
      let a = await openAlerts(db, site)
      expect(a.ssl_expiring).toMatchObject({ severity: 'warning', params: { days: expect.any(Number) } })
      await db.query(`update public.alerts set notified_at = now() where site_id = $1`, [site])   // e-mail verstuurd
      await check(db, site, { valid: true, expiresInDays: 2 })
      a = await openAlerts(db, site)
      expect(a.ssl_expiring).toMatchObject({ severity: 'critical', notified_at: null })          // opnieuw in de wachtrij
      await check(db, site, { valid: true, expiresInDays: 60 })
      expect((await openAlerts(db, site)).ssl_expiring).toBeUndefined()
    }))

  it('ongeldig certificaat → kritiek; onbereikbaar geeft géén SSL-melding', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await heartbeat(db, site)
      await check(db, site, { valid: false, error: 'self_signed' })
      expect((await openAlerts(db, site)).ssl_invalid).toMatchObject({ severity: 'critical', params: { error: 'self_signed' } })
      await check(db, site, { valid: false, error: 'unreachable' })
      expect((await openAlerts(db, site)).ssl_invalid).toBeUndefined()
    }))

  it('site op http:// → waarschuwing "geen HTTPS"', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await db.query(`update public.sites set url = 'http://zonder-ssl.example' where id = $1`, [site])
      await heartbeat(db, site)
      expect((await openAlerts(db, site)).ssl_missing).toMatchObject({ severity: 'warning' })
    }))

  it('domein < 30 d → waarschuwing, < 7 d → kritiek; niet gepubliceerd → geen melding', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await heartbeat(db, site)
      await check(db, site, { valid: true, domainDays: 20 })
      expect((await openAlerts(db, site)).domain_expiring).toMatchObject({ severity: 'warning' })
      await check(db, site, { valid: true, domainDays: 5 })
      expect((await openAlerts(db, site)).domain_expiring).toMatchObject({ severity: 'critical' })
      await check(db, site, { valid: true, domainDays: null, domainError: 'not_published' })
      expect((await openAlerts(db, site)).domain_expiring).toBeUndefined()
    }))
})

describe('Drempels: PHP, geheugen, schijf, updates', () => {
  it('PHP-end-of-life volgens php.net', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await heartbeat(db, site, { php_version: '8.1.31' })
      expect((await openAlerts(db, site)).php_eol).toMatchObject({ severity: 'critical', params: { version: '8.1', eol: '2025-12-31' } })
      await heartbeat(db, site, { php_version: '8.2.29' })   // EOL 31-12-2026, binnen 180 dagen
      expect((await openAlerts(db, site)).php_eol).toMatchObject({ severity: 'warning', params: { version: '8.2', eol: '2026-12-31' } })
      await heartbeat(db, site, { php_version: '8.3.12' })
      expect((await openAlerts(db, site)).php_eol).toBeUndefined()
    }))

  it('geheugenlimiet < 128 MB → waarschuwing, < 64 → kritiek; onbeperkt → niets', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await heartbeat(db, site, { memory_limit_mb: 96 })
      expect((await openAlerts(db, site)).memory_low).toMatchObject({ severity: 'warning', params: { mb: 96 } })
      await heartbeat(db, site, { memory_limit_mb: 32 })
      expect((await openAlerts(db, site)).memory_low).toMatchObject({ severity: 'critical' })
      await heartbeat(db, site, { memory_limit_mb: null })
      expect((await openAlerts(db, site)).memory_low).toBeUndefined()
    }))

  it('schijfruimte < 1 GB → waarschuwing, < 256 MB → kritiek', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await heartbeat(db, site, { disk_free_mb: 800 })
      expect((await openAlerts(db, site)).disk_low).toMatchObject({ severity: 'warning' })
      await heartbeat(db, site, { disk_free_mb: 100 })
      expect((await openAlerts(db, site)).disk_low).toMatchObject({ severity: 'critical' })
    }))

  it('core-update → waarschuwing; plugin-updates → info zonder e-mail', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await heartbeat(db, site, {}, [
        { type: 'core', slug: 'wordpress', name: 'WordPress', version: '7.1.2', latest_version: '7.2', update_available: true, active: true },
        { type: 'plugin', slug: 'a/a.php', name: 'A', version: '1', latest_version: '2', update_available: true, active: true },
        { type: 'theme', slug: 't', name: 'T', version: '1', latest_version: '2', update_available: true, active: false },
      ])
      const a = await openAlerts(db, site)
      expect(a.core_update).toMatchObject({ severity: 'warning', params: { version: '7.2' }, notified_at: null })
      expect(a.plugin_updates).toMatchObject({ severity: 'info', params: { count: 2 } })
      expect(a.plugin_updates!.notified_at).not.toBeNull()
    }))
})

describe('E-mailwachtrij', () => {
  it('claimt warning/critical één keer, naar eigenaren en beheerders (niet leden)', () =>
    inTx(async db => {
      const { a, site } = await connectedSite(db)
      await heartbeat(db, site, { php_version: '8.1.0' })
      await actAs(db, { role: 'service_role' })
      const first = await db.query(`select * from public.claim_alert_notifications(10)`)
      expect(first.rows).toHaveLength(1)
      expect(first.rows[0]).toMatchObject({ kind: 'opened', type: 'php_eol', severity: 'critical', agency_name: 'Bureau mon', locale: 'nl' })
      expect([...first.rows[0].recipients].sort()).toEqual([a.owner.email, a.admin.email].sort())
      const again = await db.query(`select * from public.claim_alert_notifications(10)`)
      expect(again.rows).toHaveLength(0)   // al geclaimd
      await db.query(`select public.complete_alert_notification($1, 'opened', true)`, [first.rows[0].alert_id])
      expect((await db.query(`select * from public.claim_alert_notifications(10)`)).rows).toHaveLength(0)
    }))

  it('mislukte verzending komt terug, maximaal 5 pogingen', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await heartbeat(db, site, { disk_free_mb: 10 })
      await actAs(db, { role: 'service_role' })
      for (let i = 1; i <= 5; i++) {
        const r = await db.query(`select * from public.claim_alert_notifications(10)`)
        expect(r.rows, `poging ${i}`).toHaveLength(1)
        await db.query(`select public.complete_alert_notification($1, 'opened', false)`, [r.rows[0].alert_id])
      }
      expect((await db.query(`select * from public.claim_alert_notifications(10)`)).rows).toHaveLength(0)
    }))

  it('site weer online na verstuurde offline-melding → herstelmelding', () =>
    inTx(async db => {
      const { site } = await connectedSite(db)
      await heartbeat(db, site)
      await db.query(`update public.sites set last_heartbeat_at = now() - interval '2 hours' where id = $1`, [site])
      await sweep(db)
      await actAs(db, { role: 'service_role' })
      const opened = await db.query(`select * from public.claim_alert_notifications(10)`)
      await db.query(`select public.complete_alert_notification($1, 'opened', true)`, [opened.rows[0].alert_id])
      await heartbeat(db, site)
      await actAs(db, { role: 'service_role' })
      const resolved = await db.query(`select kind, type from public.claim_alert_notifications(10)`)
      expect(resolved.rows).toEqual([{ kind: 'resolved', type: 'site_offline' }])
    }))
})

describe('Rechten op meldingen', () => {
  it('bureau B ziet de meldingen van A niet en kan ze niet bevestigen', () =>
    inTx(async db => {
      const { a, site } = await connectedSite(db, 'ma')
      const b = await seedAgency(db, 'mb')
      await heartbeat(db, site, { php_version: '8.0.30' })
      await actAs(db, { role: 'authenticated', ...b.owner })
      expect((await db.query(`select count(*)::int n from public.alerts`)).rows[0].n).toBe(0)
      const id = (await (async () => { await asSuper(db); return db.query(`select id from public.alerts where site_id = $1`, [site]) })()).rows[0].id
      await actAs(db, { role: 'authenticated', ...b.owner })
      expect((await expectError(db, `select public.acknowledge_alert($1)`, [id])).code).toBe('42501')
      await actAs(db, { role: 'authenticated', ...a.member })
      await db.query(`select public.acknowledge_alert($1)`, [id])
      expect((await db.query(`select acknowledged_at is not null ok from public.alerts where id = $1`, [id])).rows[0].ok).toBe(true)
    }))

  it('gebruikers kunnen de wachtrij, sweep en checks niet aanroepen, en meldingen niet wijzigen', () =>
    inTx(async db => {
      const { a, site } = await connectedSite(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      for (const sql of [`select public.sweep_alerts()`, `select * from public.claim_alert_notifications(1)`,
        `select public.complete_alert_notification(gen_random_uuid(), 'opened', true)`,
        `select public.record_site_checks('${site}', true, now(), 'x', null, null, null, false)`,
        `update public.alerts set status = 'resolved'`, `delete from public.alerts`]) {
        expect((await expectError(db, sql)).code, sql).toBe('42501')
      }
      await actAs(db, { role: 'anon' })
      expect((await expectError(db, `select * from public.alerts`)).code).toBe('42501')
    }))
})
