import { afterAll, describe, expect, it } from 'vitest'
import { actAs, asSuper, expectError, inTx, pool, seedAgency, type Db } from './helpers'

afterAll(() => pool.end())

const finding = (over: Record<string, unknown> = {}) => ({
  vulnerability_id: 'wf-1', type: 'plugin', slug: 'akismet/akismet.php', name: 'Akismet',
  installed_version: '5.0', fixed_version: '5.3', severity: 'high', fixable: true, ...over,
})

/** Gekoppelde site (connector 2.2.0) met een Akismet-update naar 5.3; feed is opgehaald. */
async function setup(db: Db, opts: { autofix?: boolean } = {}) {
  const a = await seedAgency(db, 'vuln')
  const site = a.siteIds[1]!
  await asSuper(db)
  await db.query(`update public.sites set connection_status = 'connected', paired_at = now(), connector_version = '2.2.0',
                  last_heartbeat_at = now() - interval '1 minute' where id = $1`, [site])
  await db.query(`update public.site_components set latest_version = '5.3', update_available = true where site_id = $1`, [site])
  await db.query(`update public.vulnerability_feed_state set fetched_at = now() - interval '1 hour'`)
  if (opts.autofix) await db.query(`update public.agencies set security_autofix = true where id = $1`, [a.id])
  return { a, site }
}

async function asWorker<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await actAs(db, { role: 'service_role' })
  try { return await fn() } finally { await asSuper(db) }
}

const sync = (db: Db, site: string, findings: unknown[]) =>
  asWorker(db, async () => (await db.query(`select public.sync_site_vulnerabilities($1, $2) n`, [site, JSON.stringify(findings)])).rows[0].n as number)
const fix = (db: Db, site: string, items: unknown[] = [{ type: 'plugin', slug: 'akismet/akismet.php' }]) =>
  asWorker(db, async () => (await db.query(`select public.start_security_fix($1, $2) id`, [site, JSON.stringify(items)])).rows[0].id as string | null)

describe('sync_site_vulnerabilities', () => {
  it('opent bevindingen en één melding per site; ernstig → kritieke melding', () =>
    inTx(async db => {
      const { site } = await setup(db)
      expect(await sync(db, site, [finding(), finding({ vulnerability_id: 'wf-2', severity: 'medium', fixable: false, fixed_version: null })])).toBe(2)
      const rows = await db.query(`select vulnerability_id, status, severity, fixable, fixed_version from public.site_vulnerabilities where site_id = $1 order by 1`, [site])
      expect(rows.rows).toEqual([
        { vulnerability_id: 'wf-1', status: 'open', severity: 'high', fixable: true, fixed_version: '5.3' },
        { vulnerability_id: 'wf-2', status: 'open', severity: 'medium', fixable: false, fixed_version: null },
      ])
      const al = await db.query(`select severity, params from public.alerts where site_id = $1 and type = 'vulnerability' and status = 'open'`, [site])
      expect(al.rows).toEqual([{ severity: 'critical', params: { count: 2, max_severity: 'high', fixable: 1, items: ['Akismet'], autofix: false } }])
      const s = await db.query(`select vulns_checked_at is not null ok from public.sites where id = $1`, [site])
      expect(s.rows[0].ok).toBe(true)
    }))

  it('weg uit de lijst → opgelost; niets meer open → melding opgelost', () =>
    inTx(async db => {
      const { site } = await setup(db)
      await sync(db, site, [finding(), finding({ vulnerability_id: 'wf-2' })])
      expect(await sync(db, site, [finding({ vulnerability_id: 'wf-2' })])).toBe(1)
      const r = await db.query(`select vulnerability_id, status, resolved_at is not null resolved from public.site_vulnerabilities where site_id = $1 order by 1`, [site])
      expect(r.rows).toEqual([{ vulnerability_id: 'wf-1', status: 'resolved', resolved: true }, { vulnerability_id: 'wf-2', status: 'open', resolved: false }])
      expect(await sync(db, site, [])).toBe(0)
      const al = await db.query(`select status from public.alerts where site_id = $1 and type = 'vulnerability'`, [site])
      expect(al.rows).toEqual([{ status: 'resolved' }])
    }))

  it('alleen lichte lekken → melding "info" (alleen in de app, geen e-mail)', () =>
    inTx(async db => {
      const { site } = await setup(db)
      await sync(db, site, [finding({ severity: 'low' })])
      const al = await db.query(`select severity, notified_at is not null skipped from public.alerts where site_id = $1 and type = 'vulnerability'`, [site])
      expect(al.rows).toEqual([{ severity: 'info', skipped: true }])
    }))

  it('sites_due_for_vulnerability_check: pas na feed, opnieuw na een nieuwe heartbeat', () =>
    inTx(async db => {
      const { site } = await setup(db)
      const due = () => asWorker(db, async () => (await db.query(`select site_id from public.sites_due_for_vulnerability_check(500)`)).rows.map(r => r.site_id))
      expect(await due()).toContain(site)
      await sync(db, site, [])
      expect(await due()).not.toContain(site)
      await db.query(`update public.sites set last_heartbeat_at = now() + interval '1 second' where id = $1`, [site])
      expect(await due()).toContain(site)
      await db.query(`update public.vulnerability_feed_state set fetched_at = null`)
      expect(await due()).toEqual([])
    }))

  it('verouderde lezing (heartbeat of feed kwam tussendoor) → niets vastgelegd, site blijft aan de beurt', () =>
    inTx(async db => {
      const { site } = await setup(db)
      const due = () => asWorker(db, async () => (await db.query(`select site_id from public.sites_due_for_vulnerability_check(500)`)).rows.map(r => r.site_id))
      const state = async () => (await db.query(`select s.heartbeat_seq::int seq, f.fetched_at::text fetched_at from public.sites s, public.vulnerability_feed_state f where s.id = $1 and f.id = 1`, [site])).rows[0]
      const syncAt = (findings: unknown[], seq: number, feedAt: string) => asWorker(db, async () =>
        (await db.query(`select public.sync_site_vulnerabilities($1, $2, $3, $4) n`, [site, JSON.stringify(findings), seq, feedAt])).rows[0].n as number | null)

      // Een heartbeat verhoogt de teller (ook als iets anders dan de heartbeat-functie hem zet).
      const before = await state()
      await db.query(`update public.sites set last_heartbeat_at = now() - interval '30 seconds' where id = $1`, [site])
      const s1 = await state()
      expect(s1.seq).toBe(before.seq + 1)
      await db.query(`update public.sites set name = name where id = $1`, [site])
      expect((await state()).seq).toBe(s1.seq)

      // Actuele lezing: vastgelegd, niet meer aan de beurt.
      expect(await syncAt([finding()], s1.seq, s1.fetched_at)).toBe(1)
      expect(await due()).not.toContain(site)

      // Worker las de onderdelen vóór de volgende heartbeat (lege lijst): geweigerd, lek blijft open, site aan de beurt.
      await db.query(`update public.sites set last_heartbeat_at = now() where id = $1`, [site])
      expect(await due()).toContain(site)
      expect(await syncAt([], s1.seq, s1.fetched_at)).toBeNull()
      const open = await db.query(`select status from public.site_vulnerabilities where site_id = $1`, [site])
      expect(open.rows).toEqual([{ status: 'open' }])
      expect(await due()).toContain(site)

      // Idem als de feed intussen vernieuwd is.
      const s2 = await state()
      await db.query(`update public.vulnerability_feed_state set fetched_at = now() where id = 1`)
      expect(await syncAt([], s2.seq, s2.fetched_at)).toBeNull()
      const s3 = await state()
      expect(await syncAt([], s3.seq, s3.fetched_at)).toBe(0)
      expect(await due()).not.toContain(site)
    }))

  it('oude aanroep zonder teller (worker van vóór de uitrol) werkt nog', () =>
    inTx(async db => {
      const { site } = await setup(db)
      expect(await sync(db, site, [finding()])).toBe(1)
      const s = await db.query(`select vulns_checked_seq = heartbeat_seq ok from public.sites where id = $1`, [site])
      expect(s.rows[0].ok).toBe(true)
    }))
})

describe('start_security_fix', () => {
  it('bureau zonder "automatisch oplossen" → geen run', () =>
    inTx(async db => {
      const { site } = await setup(db)
      await sync(db, site, [finding()])
      expect(await fix(db, site)).toBeNull()
      const r = await db.query(`select count(*)::int n from public.update_runs where site_id = $1`, [site])
      expect(r.rows[0].n).toBe(0)
    }))

  it('aan: start een run door Verploy (trigger security, zonder gebruiker) en probeert dezelfde versie maar één keer', () =>
    inTx(async db => {
      const { site } = await setup(db, { autofix: true })
      await sync(db, site, [finding()])
      const id = await fix(db, site)
      expect(id).toBeTruthy()
      const run = await db.query(`select trigger, created_by, items from public.update_runs where id = $1`, [id])
      expect(run.rows[0]).toEqual({ trigger: 'security', created_by: null,
        items: [{ type: 'plugin', slug: 'akismet/akismet.php', name: 'Akismet', from_version: '5.0', to_version: '5.3' }] })
      const ev = await db.query(`select message_key from public.update_run_events where run_id = $1`, [id])
      expect(ev.rows).toEqual([{ message_key: 'run.queued_security' }])
      const sv = await db.query(`select autofix_run_id, autofix_target from public.site_vulnerabilities where site_id = $1 and vulnerability_id = 'wf-1'`, [site])
      expect(sv.rows[0]).toEqual({ autofix_run_id: id, autofix_target: '5.3' })
      // Run loopt nog → niets nieuws
      expect(await fix(db, site)).toBeNull()
      // Run tegengehouden → niet opnieuw proberen voor dezelfde versie
      await db.query(`update public.update_runs set status = 'done', verdict = 'blocked', finished_at = now() where id = $1`, [id])
      expect(await fix(db, site)).toBeNull()
      // Nieuwe versie beschikbaar → wél opnieuw
      await db.query(`update public.site_components set latest_version = '5.3.1' where site_id = $1`, [site])
      expect(await fix(db, site)).toBeTruthy()
    }))

  it('alleen ernstig/kritiek en oplosbaar', () =>
    inTx(async db => {
      const { site } = await setup(db, { autofix: true })
      await sync(db, site, [finding({ severity: 'medium' })])
      expect(await fix(db, site)).toBeNull()
      await sync(db, site, [finding({ fixable: false })])
      expect(await fix(db, site)).toBeNull()
    }))

  it('opnieuw open na oplossen → automatisch oplossen mag weer', () =>
    inTx(async db => {
      const { site } = await setup(db, { autofix: true })
      await sync(db, site, [finding()])
      const id = await fix(db, site)
      await db.query(`update public.update_runs set status = 'done', verdict = 'deployed', finished_at = now() where id = $1`, [id])
      await sync(db, site, [])
      await sync(db, site, [finding()])
      const sv = await db.query(`select status, autofix_run_id from public.site_vulnerabilities where site_id = $1 and vulnerability_id = 'wf-1'`, [site])
      expect(sv.rows[0]).toEqual({ status: 'open', autofix_run_id: null })
      expect(await fix(db, site)).toBeTruthy()
    }))

  it('alleen-lezen bureau (abonnement beëindigd) → geen run', () =>
    inTx(async db => {
      const { a, site } = await setup(db, { autofix: true })
      await db.query(`update public.agencies set plan_status = 'canceled' where id = $1`, [a.id])
      await sync(db, site, [finding()])
      expect(await fix(db, site)).toBeNull()
    }))
})

describe('pending_security_fixes', () => {
  const pending = (db: Db) => asWorker(db, async () => (await db.query(`select site_id, items from public.pending_security_fixes(100)`)).rows)
  it('alleen bij "automatisch" aan, oplosbaar ernstig lek, geen poging voor deze versie en geen lopende run', () =>
    inTx(async db => {
      const { a, site } = await setup(db)
      await sync(db, site, [finding()])
      expect((await pending(db)).filter(r => r.site_id === site)).toEqual([])
      await db.query(`update public.agencies set security_autofix = true where id = $1`, [a.id])
      expect((await pending(db)).filter(r => r.site_id === site)).toEqual([{ site_id: site, items: [{ type: 'plugin', slug: 'akismet/akismet.php' }] }])
      const id = await fix(db, site)
      expect(id).toBeTruthy()
      expect((await pending(db)).filter(r => r.site_id === site)).toEqual([])   // run loopt + al geprobeerd
      await db.query(`update public.update_runs set status = 'done', verdict = 'blocked', finished_at = now() where id = $1`, [id])
      expect((await pending(db)).filter(r => r.site_id === site)).toEqual([])   // zelfde versie niet opnieuw
    }))
})

describe('rechten', () => {
  it('worker-RPC\'s zijn niet aanroepbaar voor gebruikers', () =>
    inTx(async db => {
      const { a, site } = await setup(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      for (const sql of [
        `select public.sync_site_vulnerabilities('${site}', '[]')`,
        `select public.start_security_fix('${site}', '[]')`,
        `select * from public.sites_due_for_vulnerability_check(1)`,
        `select * from public.pending_security_fixes(1)`,
      ]) expect((await expectError(db, sql)).code).toBe('42501')
    }))

  it('automatisch oplossen aanzetten: eigenaar en beheerder wel, lid niet', () =>
    inTx(async db => {
      const { a } = await setup(db)
      await actAs(db, { role: 'authenticated', ...a.member })
      expect((await db.query(`update public.agencies set security_autofix = true where id = $1`, [a.id])).rowCount).toBe(0)
      await actAs(db, { role: 'authenticated', ...a.admin })
      expect((await db.query(`update public.agencies set security_autofix = true where id = $1`, [a.id])).rowCount).toBe(1)
    }))

  it('feedgegevens zijn leesbaar voor ingelogde gebruikers, niet schrijfbaar', () =>
    inTx(async db => {
      const { a } = await setup(db)
      await db.query(`insert into public.vulnerabilities (id, software_type, slug, name, title, affected, severity)
                      values ('wf-x', 'plugin', 'akismet', 'Akismet', 'XSS', '[]', 'high')`)
      await actAs(db, { role: 'authenticated', ...a.member })
      const r = await db.query(`select count(*)::int n from public.vulnerabilities where id = 'wf-x'`)
      expect(r.rows[0].n).toBe(1)
      expect((await expectError(db, `delete from public.vulnerabilities`)).code).toBe('42501')
    }))
})
