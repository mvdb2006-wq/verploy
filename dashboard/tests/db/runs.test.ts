import { afterAll, describe, expect, it } from 'vitest'
import { actAs, asSuper, expectError, inTx, pool, seedAgency, type Agency, type Db } from './helpers'

afterAll(() => pool.end())

const AKISMET = [{ type: 'plugin', slug: 'akismet/akismet.php' }]

/** Bureau met een gekoppelde site (connector 2.1.0) waarvoor een Akismet-update klaarstaat. */
async function readySite(db: Db, label = 'run', opts: { connector?: string } = {}) {
  const a = await seedAgency(db, label)
  const site = a.siteIds[1]!  // site 0 heeft al een afgeronde run uit de seed
  await asSuper(db)
  await db.query(
    `update public.sites set connection_status = 'connected', paired_at = now(), connector_version = $2 where id = $1`,
    [site, opts.connector ?? '2.1.0'],
  )
  await db.query(
    `update public.site_components set latest_version = '5.3', update_available = true where site_id = $1 and slug = 'akismet/akismet.php'`,
    [site],
  )
  return { a, site }
}

async function createRun(db: Db, a: Agency, site: string, who: 'owner' | 'admin' | 'member' = 'member', items: unknown = AKISMET) {
  await actAs(db, { role: 'authenticated', ...a[who] })
  const r = await db.query<{ id: string }>(`select public.create_update_run($1, $2) as id`, [site, JSON.stringify(items)])
  await asSuper(db)
  return r.rows[0]!.id
}

async function asWorker<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await actAs(db, { role: 'service_role' })
  try { return await fn() } finally { await asSuper(db) }
}

describe('create_update_run', () => {
  it('elk lid (ook member) kan een run starten; de server bepaalt de versies', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      const id = await createRun(db, a, site, 'member')
      const r = await db.query(`select status, items, created_by from public.update_runs where id = $1`, [id])
      expect(r.rows[0].status).toBe('queued')
      expect(r.rows[0].created_by).toBe(a.member.id)
      expect(r.rows[0].items).toEqual([{ type: 'plugin', slug: 'akismet/akismet.php', name: 'Akismet', from_version: '5.0', to_version: '5.3' }])
      const ev = await db.query(`select message_key, params from public.update_run_events where run_id = $1`, [id])
      expect(ev.rows).toEqual([{ message_key: 'run.queued', params: { count: 1 } }])
    }))

  it('meegestuurde versies uit de browser worden genegeerd, dubbele items samengevoegd', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      const id = await createRun(db, a, site, 'owner', [
        { type: 'plugin', slug: 'akismet/akismet.php', to_version: '99.0' },
        { type: 'plugin', slug: 'akismet/akismet.php' },
      ])
      const r = await db.query(`select items from public.update_runs where id = $1`, [id])
      expect(r.rows[0].items).toHaveLength(1)
      expect(r.rows[0].items[0].to_version).toBe('5.3')
    }))

  it('geweigerd voor een site van een ander bureau', () =>
    inTx(async db => {
      const { site } = await readySite(db, 'b')
      const other = await seedAgency(db, 'a')
      await actAs(db, { role: 'authenticated', ...other.owner })
      const err = await expectError(db, `select public.create_update_run($1, $2)`, [site, JSON.stringify(AKISMET)])
      expect(err.code).toBe('42501')
    }))

  it('geweigerd zonder beschikbare update, voor onbekende componenten en zonder items', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      const e1 = await expectError(db, `select public.create_update_run($1, $2)`, [site, JSON.stringify([{ type: 'plugin', slug: 'bestaat/niet.php' }])])
      expect(e1.message).toBe('no_update_available')
      const e2 = await expectError(db, `select public.create_update_run($1, '[]')`, [site])
      expect(e2.message).toBe('no_items')
      await asSuper(db)
      await db.query(`update public.site_components set update_available = false where site_id = $1`, [site])
      await actAs(db, { role: 'authenticated', ...a.owner })
      const e3 = await expectError(db, `select public.create_update_run($1, $2)`, [site, JSON.stringify(AKISMET)])
      expect(e3.message).toBe('no_update_available')
    }))

  it('geweigerd als de site niet gekoppeld is of een te oude connector heeft', () =>
    inTx(async db => {
      const { a, site } = await readySite(db, 'old', { connector: '2.0.0' })
      await actAs(db, { role: 'authenticated', ...a.owner })
      expect((await expectError(db, `select public.create_update_run($1, $2)`, [site, JSON.stringify(AKISMET)])).message).toBe('connector_outdated')
      await asSuper(db)
      await db.query(`update public.sites set connector_version = '2.10.1' where id = $1`, [site])
      await actAs(db, { role: 'authenticated', ...a.owner })
      await db.query(`select public.create_update_run($1, $2)`, [site, JSON.stringify(AKISMET)])  // 2.10 > 2.1: numeriek vergeleken
      await asSuper(db)
      await db.query(`update public.update_runs set status = 'done', verdict = 'cancelled', finished_at = now() where site_id = $1`, [site])
      await db.query(`update public.sites set connection_status = 'awaiting_pairing' where id = $1`, [site])
      await actAs(db, { role: 'authenticated', ...a.owner })
      expect((await expectError(db, `select public.create_update_run($1, $2)`, [site, JSON.stringify(AKISMET)])).message).toBe('not_connected')
    }))

  it('geweigerd als het bureau alleen-lezen is (proefperiode verlopen)', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      await db.query(`update public.agencies set plan_status = 'trialing', trial_ends_at = now() - interval '1 day' where id = $1`, [a.id])
      await actAs(db, { role: 'authenticated', ...a.owner })
      expect((await expectError(db, `select public.create_update_run($1, $2)`, [site, JSON.stringify(AKISMET)])).message).toBe('read_only')
    }))

  it('maar één actieve run per site', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      await createRun(db, a, site)
      await actAs(db, { role: 'authenticated', ...a.admin })
      expect((await expectError(db, `select public.create_update_run($1, $2)`, [site, JSON.stringify(AKISMET)])).message).toBe('run_active')
    }))

  it('gebruikers kunnen runs, tijdlijn en resultaten niet rechtstreeks schrijven', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      const id = await createRun(db, a, site)
      await actAs(db, { role: 'authenticated', ...a.owner })
      for (const sql of [
        `update public.update_runs set status = 'done', verdict = 'deployed', finished_at = now() where id = '${id}'`,
        `insert into public.update_runs (agency_id, site_id, items) values ('${a.id}', '${site}', '[{}]')`,
        `delete from public.update_runs where id = '${id}'`,
        `insert into public.update_run_events (agency_id, run_id, step, message_key) values ('${a.id}', '${id}', 'x', 'x')`,
        `insert into public.test_results (agency_id, run_id, phase, page_key, page_url, viewport, passed) values ('${a.id}', '${id}', 'staging_after', 'home', 'x', 'desktop', true)`,
      ]) {
        expect((await expectError(db, sql)).code, sql).toBe('42501')
      }
    }))

  it('een site met een lopende run kan niet worden verwijderd', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      await createRun(db, a, site)
      await actAs(db, { role: 'authenticated', ...a.owner })
      expect((await expectError(db, `delete from public.sites where id = $1`, [site])).message).toBe('run_active')
    }))
})

describe('cancel_update_run', () => {
  it('wachtende run zonder worker: direct geannuleerd', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      const id = await createRun(db, a, site)
      await actAs(db, { role: 'authenticated', ...a.member })
      await db.query(`select public.cancel_update_run($1)`, [id])
      await asSuper(db)
      const r = await db.query(`select status, verdict, finished_at is not null as finished from public.update_runs where id = $1`, [id])
      expect(r.rows[0]).toEqual({ status: 'done', verdict: 'cancelled', finished: true })
    }))

  it('lopende run: alleen een verzoek (de worker ruimt op); na de deploy-start niet meer', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      const id = await createRun(db, a, site)
      await asWorker(db, () => db.query(`select * from public.claim_update_run('w1', 60)`))
      await actAs(db, { role: 'authenticated', ...a.member })
      await db.query(`select public.cancel_update_run($1)`, [id])
      await asSuper(db)
      expect((await db.query(`select status, cancel_requested from public.update_runs where id = $1`, [id])).rows[0]).toEqual({ status: 'queued', cancel_requested: true })
      expect((await asWorker(db, () => db.query(`select public.renew_update_run($1, 'w1', 60) as c`, [id]))).rows[0].c).toBe(true)
      await asWorker(db, () => db.query(`select public.advance_update_run($1, 'w1', 'deploy_apply')`, [id]))
      await actAs(db, { role: 'authenticated', ...a.member })
      expect((await expectError(db, `select public.cancel_update_run($1)`, [id])).message).toBe('not_cancellable')
    }))

  it('niet voor runs van een ander bureau', () =>
    inTx(async db => {
      const { a, site } = await readySite(db, 'b')
      const id = await createRun(db, a, site)
      const other = await seedAgency(db, 'a')
      await actAs(db, { role: 'authenticated', ...other.owner })
      expect((await expectError(db, `select public.cancel_update_run($1)`, [id])).code).toBe('42501')
    }))
})

describe('Worker-functies', () => {
  it('niet aanroepbaar voor ingelogde gebruikers of anon', () =>
    inTx(async db => {
      for (const who of [{ role: 'anon' as const }, { role: 'authenticated' as const, id: '99999999-9999-4999-8999-999999999999', email: 'x@example.test' }]) {
        await actAs(db, who)
        for (const fn of [`claim_update_run('w', 60)`, `renew_update_run(gen_random_uuid(), 'w', 60)`,
          `advance_update_run(gen_random_uuid(), 'w', 'done')`, `release_update_run(gen_random_uuid(), 'w', 0)`]) {
          expect((await expectError(db, `select public.${fn}`)).code, fn).toBe('42501')
        }
      }
    }))

  it('claim: pakt een run één keer; een tweede worker krijgt niets zolang de lease loopt', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      const id = await createRun(db, a, site)
      const first = await asWorker(db, () => db.query(`select id, worker_id, attempt from public.claim_update_run('w1', 60)`))
      expect(first.rows).toEqual([{ id, worker_id: 'w1', attempt: 1 }])
      const second = await asWorker(db, () => db.query(`select id from public.claim_update_run('w2', 60)`))
      expect(second.rows.filter(r => r.id === id)).toHaveLength(0)
    }))

  it('verlopen lease (worker gecrasht): een andere worker neemt over, attempt telt op', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      const id = await createRun(db, a, site)
      await asWorker(db, () => db.query(`select * from public.claim_update_run('w1', 60)`))
      await db.query(`update public.update_runs set lease_until = now() - interval '1 second' where id = $1`, [id])
      const taken = await asWorker(db, () => db.query(`select id, worker_id, attempt from public.claim_update_run('w2', 60)`))
      expect(taken.rows.find(r => r.id === id)).toEqual({ id, worker_id: 'w2', attempt: 2 })
      // de oude worker is zijn run kwijt
      expect((await asWorker(db, () => db.query(`select public.renew_update_run($1, 'w1', 60) as c`, [id]))).rows[0].c).toBeNull()
      await actAs(db, { role: 'service_role' })
      expect((await expectError(db, `select public.advance_update_run($1, 'w1', 'baseline')`, [id])).message).toBe('lease_lost')
    }))

  it('advance: volgende stap begint bij poging 1 en voegt step_state samen; done vraagt een verdict', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      const id = await createRun(db, a, site)
      await asWorker(db, () => db.query(`select * from public.claim_update_run('w1', 60)`))
      await asWorker(db, () => db.query(`select public.advance_update_run($1, 'w1', 'baseline', '{"a":1}')`, [id]))
      await asWorker(db, () => db.query(`select public.advance_update_run($1, 'w1', 'staging_create', '{"b":2}')`, [id]))
      const r = await db.query(`select status, attempt, step_state from public.update_runs where id = $1`, [id])
      expect(r.rows[0]).toEqual({ status: 'staging_create', attempt: 1, step_state: { a: 1, b: 2 } })
      await actAs(db, { role: 'service_role' })
      await expectError(db, `select public.advance_update_run($1, 'w1', 'done')`, [id])
      await db.query(`select public.advance_update_run($1, 'w1', 'done', '{}', 'blocked', 'run.reason.visual', '{"page":"Home"}')`, [id])
      await asSuper(db)
      const done = await db.query(`select status, verdict, reason_key, reason_params, worker_id, lease_until from public.update_runs where id = $1`, [id])
      expect(done.rows[0]).toEqual({ status: 'done', verdict: 'blocked', reason_key: 'run.reason.visual', reason_params: { page: 'Home' }, worker_id: null, lease_until: null })
      // afgerond = de site is weer vrij voor een nieuwe run
      await createRun(db, a, site)
    }))

  it('release: tijdelijke fout → later opnieuw, door wie dan ook', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      const id = await createRun(db, a, site)
      await asWorker(db, () => db.query(`select * from public.claim_update_run('w1', 60)`))
      await asWorker(db, () => db.query(`select public.release_update_run($1, 'w1', 3600)`, [id]))
      expect((await asWorker(db, () => db.query(`select id from public.claim_update_run('w2', 60)`))).rows.filter(r => r.id === id)).toHaveLength(0)
      await db.query(`update public.update_runs set not_before = now() where id = $1`, [id])
      expect((await asWorker(db, () => db.query(`select id, attempt from public.claim_update_run('w2', 60)`))).rows.find(r => r.id === id)).toEqual({ id, attempt: 2 })
    }))

  it('tijdlijn en resultaten kunnen niet aan een run van een ander bureau hangen', () =>
    inTx(async db => {
      const { a, site } = await readySite(db, 'a')
      const id = await createRun(db, a, site)
      const b = await seedAgency(db, 'b')
      await actAs(db, { role: 'service_role' })
      expect((await expectError(db, `insert into public.update_run_events (agency_id, run_id, step, message_key) values ($1, $2, 'x', 'x')`, [b.id, id])).message).toBe('agency_mismatch')
    }))
})

describe('Diagnoses', () => {
  it('alleen de service role schrijft; de melding neemt de samenvatting mee', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      const id = await createRun(db, a, site)
      await actAs(db, { role: 'authenticated', ...a.owner })
      expect((await expectError(db, `insert into public.diagnoses (run_id, agency_id, source, locale, summary, cause, fix, confidence) values ($1, $2, 'rules', 'nl', 'x', 'x', 'x', 'low')`, [id, a.id])).code).toBe('42501')
      await asWorker(db, () => db.query(`select * from public.claim_update_run('w1', 60)`))
      await asWorker(db, () => db.query(`select public.advance_update_run($1, 'w1', 'done', '{}', 'blocked', 'run.reason.check.php_error', '{}')`, [id]))
      await asWorker(db, () => db.query(`insert into public.diagnoses (run_id, agency_id, source, locale, summary, cause, fix, confidence) values ($1, $2, 'rules', 'nl', 'Akismet 5.3 roept een ontbrekende functie aan.', 'c', 'f', 'high')`, [id, a.id]))
      await asWorker(db, () => db.query(`select public.record_run_outcome($1)`, [id]))
      const alert = await db.query(`select type, params->>'diagnosis' as diagnosis from public.alerts where site_id = $1 and status = 'open' and type = 'update_blocked'`, [site])
      expect(alert.rows).toEqual([{ type: 'update_blocked', diagnosis: 'Akismet 5.3 roept een ontbrekende functie aan.' }])
    }))

  it('gedeeltelijk live: oude updatemeldingen dicht, nieuwe melding noemt alleen wat aandacht vraagt', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      const id = await createRun(db, a, site)
      await asWorker(db, () => db.query(`select app.raise_alert($1, $2, 'update_rolled_back', 'critical', '{}')`, [site, a.id]))
      await asWorker(db, () => db.query(`select * from public.claim_update_run('w1', 60)`))
      await asWorker(db, () => db.query(`select public.advance_update_run($1, 'w1', 'done', '{}', 'deployed', 'run.reason.partial', $2)`,
        [id, JSON.stringify({ deployed: 1, total: 2, attention: ['WPBakery Page Builder'] })]))
      await asWorker(db, () => db.query(`select public.record_run_outcome($1)`, [id]))
      const open = await db.query(`select type, severity, params->'items' items, params->>'partial' partial, params->>'deployed' deployed
                                     from public.alerts where site_id = $1 and status = 'open' and type like 'update_%'`, [site])
      expect(open.rows).toEqual([{ type: 'update_blocked', severity: 'warning', items: ['WPBakery Page Builder'], partial: 'true', deployed: '1' }])
    }))

  it('volledig live: geen updatemelding', () =>
    inTx(async db => {
      const { a, site } = await readySite(db)
      const id = await createRun(db, a, site)
      await asWorker(db, () => db.query(`select * from public.claim_update_run('w1', 60)`))
      await asWorker(db, () => db.query(`select public.advance_update_run($1, 'w1', 'done', '{}', 'deployed', null, '{}')`, [id]))
      await asWorker(db, () => db.query(`select public.record_run_outcome($1)`, [id]))
      const open = await db.query(`select count(*)::int n from public.alerts where site_id = $1 and status = 'open' and type like 'update_%'`, [site])
      expect(open.rows[0].n).toBe(0)
    }))

  it('een diagnose kan niet aan een run van een ander bureau hangen', () =>
    inTx(async db => {
      const { a, site } = await readySite(db, 'a')
      const id = await createRun(db, a, site)
      const b = await seedAgency(db, 'b')
      await actAs(db, { role: 'service_role' })
      expect((await expectError(db, `insert into public.diagnoses (run_id, agency_id, source, locale, summary, cause, fix, confidence) values ($1, $2, 'rules', 'nl', 'x', 'x', 'x', 'low')`, [id, b.id])).message).toBe('agency_mismatch')
    }))
})
