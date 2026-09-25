import { afterAll, describe, expect, it } from 'vitest'
import { actAs, asSuper, expectError, inTx, pool, seedAgency, type Db } from './helpers'

afterAll(() => pool.end())

const ADMINS = [{ id: 1, login: 'bureau', name: 'Bureau' }, { id: 7, login: 'klant', name: 'Klant' }]

async function setup(db: Db, raw: Record<string, unknown> = { admins: ADMINS, sso: { enabled: true } }, version = '2.5.0') {
  const a = await seedAgency(db, 'wplogin')
  const site = a.siteIds[1]!
  await asSuper(db)
  await db.query(`update public.sites set connection_status = 'connected', connector_version = $2, url = 'https://klant.example' where id = $1`, [site, version])
  await db.query(`insert into public.health_snapshots (agency_id, site_id, captured_at, raw) values ($1, $2, now(), $3)`, [a.id, site, JSON.stringify(raw)])
  return { a, site }
}
/** Ingelogd mét tweestapsverificatie (aal2), tenzij anders gezegd. */
async function as(db: Db, who: { id: string; email?: string }, aal = 'aal2') {
  await actAs(db, { role: 'authenticated', email: '', ...who })
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who.id, role: 'authenticated', email: who.email ?? '', aud: 'authenticated', aal })])
}
async function start(db: Db, who: { id: string; email?: string }, site: string) {
  await as(db, who)
  try { return (await db.query(`select * from public.start_wp_login($1)`, [site])).rows[0] } finally { await asSuper(db) }
}
async function startError(db: Db, who: { id: string }, site: string, aal = 'aal2') {
  await as(db, who, aal)
  try { return (await expectError(db, `select * from public.start_wp_login('${site}')`)).message } finally { await asSuper(db) }
}

describe('inloggen in WP Admin', () => {
  it('eigenaar: standaard als eerste beheerder; eenmalige nonce; vastgelegd', () =>
    inTx(async db => {
      const { a, site } = await setup(db)
      const r = await start(db, a.owner, site)
      expect(r).toMatchObject({ wp_user_id: 1, wp_user_login: 'bureau' })
      expect(r.nonce).toMatch(/^[0-9a-f]{32}$/)
      const r2 = await start(db, a.owner, site)
      expect(r2.nonce).not.toBe(r.nonce)
      const log = await db.query(`select user_id, wp_user_id from public.wp_logins where site_id = $1`, [site])
      expect(log.rows).toHaveLength(2)
      expect(log.rows[0].user_id).toBe(a.owner.id)
    }))

  it('gekozen beheerder wordt gebruikt; bestaat die niet meer, dan de eerste', () =>
    inTx(async db => {
      const { a, site } = await setup(db)
      await db.query(`update public.sites set wp_login_user_id = 7 where id = $1`, [site])
      expect((await start(db, a.admin, site)).wp_user_login).toBe('klant')
      await db.query(`update public.sites set wp_login_user_id = 99 where id = $1`, [site])
      expect((await start(db, a.admin, site)).wp_user_login).toBe('bureau')
    }))

  it('zonder tweestapsverificatie in deze sessie (aal1): geweigerd', () =>
    inTx(async db => {
      const { a, site } = await setup(db)
      expect(await startError(db, a.owner, site, 'aal1')).toContain('mfa_required')
      const log = await db.query(`select count(*)::int n from public.wp_logins where site_id = $1`, [site])
      expect(log.rows[0].n).toBe(0)
    }))

  it('lid, ander bureau of anoniem: geweigerd', () =>
    inTx(async db => {
      const { a, site } = await setup(db)
      expect(await startError(db, a.member, site)).toContain('forbidden')
      const b = await seedAgency(db, 'wplogin-b')
      expect(await startError(db, b.owner, site)).toContain('forbidden')
    }))

  it('oude connector, uitgezet op de site, geen beheerder bekend: duidelijke fout', () =>
    inTx(async db => {
      const old = await setup(db, { admins: ADMINS, sso: { enabled: true } }, '2.4.0')
      expect(await startError(db, old.a.owner, old.site)).toContain('connector_outdated')
      const off = await setup(db, { admins: ADMINS, sso: { enabled: false } })
      expect(await startError(db, off.a.owner, off.site)).toContain('sso_disabled')
      const none = await setup(db, { admins: [], sso: { enabled: true } })
      expect(await startError(db, none.a.owner, none.site)).toContain('no_admin')
    }))

  it('alleen via https (lokaal testen uitgezonderd); versie "2.5" telt als 2.5.0', () =>
    inTx(async db => {
      const { a, site } = await setup(db, { admins: ADMINS, sso: { enabled: true } }, '2.5')
      await db.query(`update public.sites set url = 'https://klant.example' where id = $1`, [site])
      expect((await start(db, a.owner, site)).wp_user_id).toBe(1)
      await db.query(`update public.sites set url = 'http://klant.example' where id = $1`, [site])
      expect(await startError(db, a.owner, site)).toContain('insecure_url')
      await db.query(`update public.sites set url = 'http://127.0.0.1:8089' where id = $1`, [site])
      expect((await start(db, a.owner, site)).wp_user_id).toBe(1)
    }))

  it('hooguit 20 per 10 minuten per gebruiker', () =>
    inTx(async db => {
      const { a, site } = await setup(db)
      for (let i = 0; i < 20; i++) await start(db, a.owner, site)
      expect(await startError(db, a.owner, site)).toContain('rate_limited')
    }))

  it('logboek: leden van het bureau zien het, een ander bureau niet; niemand schrijft er direct in', () =>
    inTx(async db => {
      const { a, site } = await setup(db)
      await start(db, a.owner, site)
      await actAs(db, { role: 'authenticated', ...a.member })
      expect((await db.query(`select count(*)::int n from public.wp_logins`)).rows[0].n).toBe(1)
      expect((await expectError(db, `insert into public.wp_logins (agency_id, site_id, user_email, wp_user_id, wp_user_login, nonce) values ('${a.id}', '${site}', 'x', 1, 'x', '${'a'.repeat(32)}')`)).code).toBe('42501')
      const b = await seedAgency(db, 'wplogin-c')
      await actAs(db, { role: 'authenticated', ...b.owner })
      expect((await db.query(`select count(*)::int n from public.wp_logins`)).rows[0].n).toBe(0)
      await asSuper(db)
    }))
})
