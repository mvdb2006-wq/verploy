import { afterAll, describe, expect, it } from 'vitest'
import { actAs, asSuper, expectError, inTx, pool, seedAgency, type Agency, type Db } from './helpers'

afterAll(() => pool.end())

/** Tabellen met bureau-data die leden mogen lezen. */
const READABLE = ['agencies', 'agency_members', 'sites', 'health_snapshots', 'site_components'] as const
/** Tabellen die voor gebruikers volledig onzichtbaar moeten zijn. */
const SECRET = ['site_credentials', 'signed_request_nonces'] as const
const ALL_TABLES = [...READABLE, 'agency_invitations', 'plans', ...SECRET] as const

const agencyCol = (t: string) => (t === 'agencies' ? 'id' : 'agency_id')

async function twoAgencies(db: Db): Promise<[Agency, Agency]> {
  return [await seedAgency(db, 'a'), await seedAgency(db, 'b')]
}

describe('RLS: bureau A kan niet bij bureau B', () => {
  for (const role of ['owner', 'admin', 'member'] as const) {
    describe(`als ${role} van A`, () => {
      for (const table of READABLE) {
        it(`${table}: ziet eigen rijen en géén rijen van B`, () =>
          inTx(async db => {
            const [a, b] = await twoAgencies(db)
            await actAs(db, { role: 'authenticated', ...a[role] })
            const col = agencyCol(table)
            const own = await db.query(`select count(*)::int n from public.${table} where ${col} = $1`, [a.id])
            const other = await db.query(`select count(*)::int n from public.${table} where ${col} = $1`, [b.id])
            const all = await db.query(`select count(*)::int n from public.${table} where ${col} <> $1`, [a.id])
            expect(own.rows[0].n).toBeGreaterThan(0)
            expect(other.rows[0].n).toBe(0)
            expect(all.rows[0].n).toBe(0)
          }))
      }

      it('kan sites van B niet wijzigen of verwijderen', () =>
        inTx(async db => {
          const [a, b] = await twoAgencies(db)
          await actAs(db, { role: 'authenticated', ...a[role] })
          const upd = await db.query(`update public.sites set name = 'gekaapt' where agency_id = $1`, [b.id])
          const del = await db.query(`delete from public.sites where agency_id = $1`, [b.id])
          expect(upd.rowCount).toBe(0)
          expect(del.rowCount).toBe(0)
          await asSuper(db)
          const check = await db.query(`select count(*)::int n from public.sites where agency_id = $1 and name <> 'gekaapt'`, [b.id])
          expect(check.rows[0].n).toBe(2)
        }))

      it('kan geen site aanmaken in bureau B', () =>
        inTx(async db => {
          const [a, b] = await twoAgencies(db)
          await actAs(db, { role: 'authenticated', ...a[role] })
          const err = await expectError(db, `insert into public.sites (agency_id, name, url) values ($1, 'x', 'https://evil.example')`, [b.id])
          expect(err.code).toBe('42501')
        }))

      it('kan bureau B niet wijzigen', () =>
        inTx(async db => {
          const [a, b] = await twoAgencies(db)
          await actAs(db, { role: 'authenticated', ...a[role] })
          const upd = await db.query(`update public.agencies set name = 'gekaapt' where id = $1`, [b.id])
          expect(upd.rowCount).toBe(0)
        }))

      it('kan geen koppelcode maken voor een site van B', () =>
        inTx(async db => {
          const [a, b] = await twoAgencies(db)
          await actAs(db, { role: 'authenticated', ...a[role] })
          const err = await expectError(db, `select public.create_pairing_code($1)`, [b.siteIds[0]])
          expect(err.code).toBe('42501')
        }))

      it('kan geen leden van B verwijderen of hun rol wijzigen', () =>
        inTx(async db => {
          const [a, b] = await twoAgencies(db)
          await actAs(db, { role: 'authenticated', ...a[role] })
          const e1 = await expectError(db, `select public.remove_member($1)`, [b.member.id])
          const e2 = await expectError(db, `select public.update_member_role($1, 'owner')`, [b.member.id])
          expect(['42501', 'P0002']).toContain(e1.code)
          expect(['42501', 'P0002']).toContain(e2.code)
          await asSuper(db)
          const still = await db.query(`select count(*)::int n from public.agency_members where agency_id = $1`, [b.id])
          expect(still.rows[0].n).toBe(3)
        }))
    })
  }

  for (const table of SECRET) {
    it(`${table}: onleesbaar voor élke ingelogde gebruiker, ook voor de eigenaar`, () =>
      inTx(async db => {
        const [a] = await twoAgencies(db)
        await actAs(db, { role: 'authenticated', ...a.owner })
        const err = await expectError(db, `select * from public.${table}`)
        expect(err.code).toBe('42501')
      }))
  }

  it('site_credentials: ook schrijven is geweigerd', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      const err = await expectError(db, `update public.site_credentials set secret_ciphertext = 'x' where site_id = $1`, [a.siteIds[0]])
      expect(err.code).toBe('42501')
    }))

  it('uitnodigingen van B zijn onzichtbaar, en een member ziet ook die van A niet', () =>
    inTx(async db => {
      const [a, b] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      const own = await db.query(`select count(*)::int n from public.agency_invitations where agency_id = $1`, [a.id])
      const other = await db.query(`select count(*)::int n from public.agency_invitations where agency_id = $1`, [b.id])
      expect(own.rows[0].n).toBe(1)
      expect(other.rows[0].n).toBe(0)
      await actAs(db, { role: 'authenticated', ...a.member })
      const asMember = await db.query(`select count(*)::int n from public.agency_invitations`)
      expect(asMember.rows[0].n).toBe(0)
    }))

  it('een gebruiker zonder bureau ziet helemaal niets', () =>
    inTx(async db => {
      await twoAgencies(db)
      await actAs(db, { role: 'authenticated', id: '99999999-9999-4999-8999-999999999999', email: 'vreemde@example.test' })
      for (const table of [...READABLE, 'agency_invitations'] as const) {
        const r = await db.query(`select count(*)::int n from public.${table}`)
        expect(r.rows[0].n, table).toBe(0)
      }
    }))
})

describe('RLS: niet-ingelogd (anon)', () => {
  for (const table of ALL_TABLES) {
    it(`${table}: geen enkele toegang`, () =>
      inTx(async db => {
        await twoAgencies(db)
        await actAs(db, { role: 'anon' })
        const err = await expectError(db, `select 1 from public.${table} limit 1`)
        expect(err.code).toBe('42501')
      }))
  }

  for (const fn of ["create_agency('x')", "create_pairing_code(gen_random_uuid())", "invite_member('a@b.nl','member')",
    "accept_invitation('x')", "update_member_role(gen_random_uuid(),'owner')", "remove_member(gen_random_uuid())"]) {
    it(`RPC ${fn.split('(')[0]}: niet aanroepbaar`, () =>
      inTx(async db => {
        await actAs(db, { role: 'anon' })
        const err = await expectError(db, `select public.${fn}`)
        expect(err.code).toBe('42501')
      }))
  }
})

describe('Rollen binnen een bureau', () => {
  it('member mag geen sites aanmaken, wijzigen of verwijderen', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.member })
      const ins = await expectError(db, `insert into public.sites (agency_id, name, url) values ($1, 'x', 'https://m.example')`, [a.id])
      expect(ins.code).toBe('42501')
      const upd = await db.query(`update public.sites set name = 'x' where agency_id = $1`, [a.id])
      const del = await db.query(`delete from public.sites where agency_id = $1`, [a.id])
      expect(upd.rowCount).toBe(0)
      expect(del.rowCount).toBe(0)
    }))

  it('admin mag sites beheren en koppelcodes maken', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.admin })
      const ins = await db.query(`insert into public.sites (agency_id, name, url) values ($1, 'Nieuw', 'https://nieuw.example') returning id`, [a.id])
      expect(ins.rowCount).toBe(1)
      const code = await db.query<{ c: string }>(`select public.create_pairing_code($1) c`, [a.siteIds[0]])
      expect(code.rows[0].c).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    }))

  it('member kan geen koppelcode maken', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.member })
      const err = await expectError(db, `select public.create_pairing_code($1)`, [a.siteIds[0]])
      expect(err.code).toBe('42501')
    }))

  it('member en admin mogen agency-billingkolommen niet wijzigen (kolomrechten)', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      for (const who of [a.owner, a.admin]) {
        await actAs(db, { role: 'authenticated', ...who })
        for (const col of ["plan_id = 'scale'", "plan_status = 'comped'", 'trial_ends_at = null', "stripe_customer_id = 'x'"]) {
          const err = await expectError(db, `update public.agencies set ${col} where id = $1`, [a.id])
          expect(err.code, col).toBe('42501')
        }
      }
    }))

  it('owner/admin kunnen naam en branding wijzigen, member niet', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.admin })
      const ok = await db.query(`update public.agencies set name = 'Nieuwe naam', brand_color = '#112233' where id = $1`, [a.id])
      expect(ok.rowCount).toBe(1)
      await actAs(db, { role: 'authenticated', ...a.member })
      const no = await db.query(`update public.agencies set name = 'Member' where id = $1`, [a.id])
      expect(no.rowCount).toBe(0)
    }))

  it('site-statusvelden zijn niet door gebruikers te zetten (alleen de heartbeat mag dat)', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      for (const col of ["status = 'online'", "connection_status = 'connected'", "connector_version = '9'", 'last_heartbeat_at = now()']) {
        const err = await expectError(db, `update public.sites set ${col} where agency_id = $1`, [a.id])
        expect(err.code, col).toBe('42501')
      }
    }))

  it('heartbeat-data is alleen-lezen voor gebruikers', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      const e1 = await expectError(db, `insert into public.health_snapshots (agency_id, site_id) values ($1, $2)`, [a.id, a.siteIds[0]])
      const e2 = await expectError(db, `delete from public.site_components where agency_id = $1`, [a.id])
      expect(e1.code).toBe('42501')
      expect(e2.code).toBe('42501')
    }))

  it('alleen de owner kan rollen wijzigen; de laatste owner kan niet weg', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.admin })
      expect((await expectError(db, `select public.update_member_role($1, 'owner')`, [a.admin.id])).code).toBe('42501')
      await actAs(db, { role: 'authenticated', ...a.owner })
      await db.query(`select public.update_member_role($1, 'admin')`, [a.member.id])
      const last = await expectError(db, `select public.update_member_role($1, 'member')`, [a.owner.id])
      expect(last.message).toContain('last_owner')
      const leave = await expectError(db, `select public.remove_member($1)`, [a.owner.id])
      expect(leave.message).toContain('last_owner')
    }))

  it('admin kan alleen members uitnodigen, geen admins', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.admin })
      const tok = await db.query<{ t: string }>(`select public.invite_member('nieuw@example.test', 'member') t`)
      expect(tok.rows[0].t).toMatch(/^[0-9a-f]{48}$/)
      expect((await expectError(db, `select public.invite_member('baas@example.test', 'admin')`)).code).toBe('42501')
      await actAs(db, { role: 'authenticated', ...a.member })
      expect((await expectError(db, `select public.invite_member('x@example.test', 'member')`)).code).toBe('42501')
    }))
})

describe('Uitnodigingen en bureau aanmaken', () => {
  it('uitnodiging accepteren werkt alleen voor het uitgenodigde e-mailadres, en maar één keer', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      const { rows: [{ t }] } = await db.query<{ t: string }>(`select public.invite_member('Nieuwe@Example.test', 'member') t`)
      await asSuper(db)
      const newcomer = { id: '77777777-7777-4777-8777-777777777777', email: 'nieuwe@example.test' }
      const intruder = { id: '88888888-8888-4888-8888-888888888888', email: 'indringer@example.test' }
      for (const u of [newcomer, intruder]) {
        await db.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
          values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, 'x', now(), now())`, [u.id, u.email])
      }
      await actAs(db, { role: 'authenticated', ...intruder })
      expect((await expectError(db, `select public.accept_invitation($1)`, [t])).message).toContain('invitation_email_mismatch')
      await actAs(db, { role: 'authenticated', ...newcomer })
      const ok = await db.query<{ a: string }>(`select public.accept_invitation($1) a`, [t])
      expect(ok.rows[0].a).toBe(a.id)
      const role = await db.query(`select role from public.agency_members where user_id = $1`, [newcomer.id])
      expect(role.rows[0].role).toBe('member')
      expect((await expectError(db, `select public.accept_invitation($1)`, [t])).message).toContain('invalid_invitation')
    }))

  it('verlopen uitnodiging wordt geweigerd', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      const { rows: [{ t }] } = await db.query<{ t: string }>(`select public.invite_member('laat@example.test', 'member') t`)
      await asSuper(db)
      await db.query(`update public.agency_invitations set expires_at = now() - interval '1 minute' where email = 'laat@example.test'`)
      const u = { id: '66666666-6666-4666-8666-666666666666', email: 'laat@example.test' }
      await db.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
        values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, 'x', now(), now())`, [u.id, u.email])
      await actAs(db, { role: 'authenticated', ...u })
      expect((await expectError(db, `select public.accept_invitation($1)`, [t])).message).toContain('invalid_invitation')
    }))

  it('create_agency: nieuwe gebruiker wordt owner, tweede bureau is geweigerd', () =>
    inTx(async db => {
      await asSuper(db)
      const u = { id: '55555555-5555-4555-8555-555555555555', email: 'nieuw-bureau@example.test' }
      await db.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
        values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, 'x', now(), now())`, [u.id, u.email])
      await actAs(db, { role: 'authenticated', ...u })
      const { rows: [{ id }] } = await db.query<{ id: string }>(`select public.create_agency('Pixel & Co Webdesign') id`)
      const ag = await db.query(`select slug, plan_id, plan_status, trial_ends_at > now() + interval '13 days' as trial from public.agencies where id = $1`, [id])
      expect(ag.rows[0]).toMatchObject({ slug: 'pixel-co-webdesign', plan_id: 'studio', plan_status: 'trialing', trial: true })
      const m = await db.query(`select role from public.agency_members where user_id = $1`, [u.id])
      expect(m.rows[0].role).toBe('owner')
      expect((await expectError(db, `select public.create_agency('Tweede')`)).message).toContain('already_member')
    }))
})

describe('Tier-limieten (server-side, geldt voor élk pad)', () => {
  it('site boven de limiet wordt geweigerd, ook voor service_role', () =>
    inTx(async db => {
      const a = await seedAgency(db, 'lim', { plan: 'solo' })   // limiet 5, heeft er al 2
      await actAs(db, { role: 'authenticated', ...a.owner })
      for (let i = 0; i < 3; i++) {
        await db.query(`insert into public.sites (agency_id, name, url) values ($1, $2, $3)`, [a.id, `s${i}`, `https://lim${i}.example`])
      }
      expect((await expectError(db, `insert into public.sites (agency_id, name, url) values ($1, 'zes', 'https://zes.example')`, [a.id])).message).toContain('site_limit_reached')
      await actAs(db, { role: 'service_role' })
      expect((await expectError(db, `insert into public.sites (agency_id, name, url) values ($1, 'zes', 'https://zes.example')`, [a.id])).message).toContain('site_limit_reached')
    }))

  it('limiet komt uit de plans-tabel: aanpassen daar werkt direct', () =>
    inTx(async db => {
      const a = await seedAgency(db, 'plan', { plan: 'solo' })
      await asSuper(db)
      await db.query(`update public.plans set sites_limit = 2 where id = 'solo'`)
      await actAs(db, { role: 'authenticated', ...a.owner })
      expect((await expectError(db, `insert into public.sites (agency_id, name, url) values ($1, 'drie', 'https://drie.example')`, [a.id])).message).toContain('site_limit_reached')
    }))

  it('verlopen proefperiode: geen nieuwe sites, bestaande blijven zichtbaar', () =>
    inTx(async db => {
      // Eerst met lopende proefperiode seeden (sites bestonden al), daarna laten verlopen.
      const a = await seedAgency(db, 'trial', { planStatus: 'trialing', trialEndsAt: new Date(Date.now() + 86_400_000).toISOString() })
      await asSuper(db)
      await db.query(`update public.agencies set trial_ends_at = now() - interval '1 minute' where id = $1`, [a.id])
      await actAs(db, { role: 'authenticated', ...a.owner })
      expect((await expectError(db, `insert into public.sites (agency_id, name, url) values ($1, 'x', 'https://x.example')`, [a.id])).message).toContain('subscription_inactive')
      const seen = await db.query(`select count(*)::int n from public.sites`)
      expect(seen.rows[0].n).toBe(2)
    }))

  it('gebruikers kunnen de plans-tabel lezen maar niet wijzigen', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      const r = await db.query(`select id, price_cents, sites_limit from public.plans order by sort_order`)
      expect(r.rows).toEqual([
        { id: 'solo', price_cents: 1900, sites_limit: 5 },
        { id: 'studio', price_cents: 4900, sites_limit: 15 },
        { id: 'agency', price_cents: 9900, sites_limit: 40 },
        { id: 'scale', price_cents: 24900, sites_limit: 120 },
      ])
      expect((await expectError(db, `update public.plans set sites_limit = 999`)).code).toBe('42501')
    }))
})

describe('Integriteit', () => {
  it('heartbeat-data kan niet aan een site van een ander bureau hangen (ook niet via service_role)', () =>
    inTx(async db => {
      const [a, b] = await twoAgencies(db)
      await actAs(db, { role: 'service_role' })
      const err = await expectError(db, `insert into public.health_snapshots (agency_id, site_id) values ($1, $2)`, [a.id, b.siteIds[0]])
      expect(err.message).toContain('agency_mismatch')
    }))

  it('elke nieuwe site krijgt automatisch een (lege) credentials-rij', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      const { rows: [s] } = await db.query<{ id: string }>(`insert into public.sites (agency_id, name, url) values ($1, 'n', 'https://n.example') returning id`, [a.id])
      await asSuper(db)
      const c = await db.query(`select secret_ciphertext, agency_id from public.site_credentials where site_id = $1`, [s.id])
      expect(c.rows[0]).toEqual({ secret_ciphertext: null, agency_id: a.id })
    }))
})

describe('Plugin-API-functies zijn alleen voor de server (service_role)', () => {
  for (const fn of ["consume_pairing_code('x','y','2.0.0')", "ingest_heartbeat(gen_random_uuid(), '{}'::jsonb, '[]'::jsonb)"]) {
    for (const who of ['anon', 'owner'] as const) {
      it(`${fn.split('(')[0]} niet aanroepbaar als ${who}`, () =>
        inTx(async db => {
          const [a] = await twoAgencies(db)
          await actAs(db, who === 'anon' ? { role: 'anon' } : { role: 'authenticated', ...a.owner })
          expect((await expectError(db, `select * from public.${fn}`)).code).toBe('42501')
        }))
    }
  }

  it('koppelcode: werkt één keer, binnen 30 minuten, en zet de site op gekoppeld', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      const { rows: [{ c }] } = await db.query<{ c: string }>(`select public.create_pairing_code($1) c`, [a.siteIds[0]])
      await actAs(db, { role: 'service_role' })
      const hash = `encode(extensions.digest($1::text, 'sha256'), 'hex')`
      const first = await db.query(`select * from public.consume_pairing_code(${hash}, 'd1:x:y:z', '2.0.0')`, [c])
      expect(first.rows).toHaveLength(1)
      expect(first.rows[0].site_id).toBe(a.siteIds[0])
      const again = await db.query(`select * from public.consume_pairing_code(${hash}, 'd1:x:y:z', '2.0.0')`, [c])
      expect(again.rows).toHaveLength(0)
      const s = await db.query(`select connection_status, connector_version from public.sites where id = $1`, [a.siteIds[0]])
      expect(s.rows[0]).toEqual({ connection_status: 'connected', connector_version: '2.0.0' })
      // vorig secret blijft 10 minuten geldig
      const cred = await db.query(`select previous_secret_ciphertext, previous_valid_until > now() + interval '9 minutes' ok from public.site_credentials where site_id = $1`, [a.siteIds[0]])
      expect(cred.rows[0]).toEqual({ previous_secret_ciphertext: 'ciphertext-a1', ok: true })
    }))

  it('verlopen koppelcode werkt niet', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      const { rows: [{ c }] } = await db.query<{ c: string }>(`select public.create_pairing_code($1) c`, [a.siteIds[0]])
      await asSuper(db)
      await db.query(`update public.site_credentials set pairing_expires_at = now() - interval '1 second' where site_id = $1`, [a.siteIds[0]])
      await actAs(db, { role: 'service_role' })
      const r = await db.query(`select * from public.consume_pairing_code(encode(extensions.digest($1::text, 'sha256'), 'hex'), 'x', null)`, [c])
      expect(r.rows).toHaveLength(0)
    }))

  it('ingest_heartbeat: vervangt componentenlijst en zet site online; weigert niet-gekoppelde site', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'service_role' })
      const site = a.siteIds[0]
      expect((await expectError(db, `select public.ingest_heartbeat($1, '{}'::jsonb, '[]'::jsonb)`, [site])).message).toContain('site_not_connected')
      await asSuper(db)
      await db.query(`update public.sites set connection_status = 'connected' where id = $1`, [site])
      await actAs(db, { role: 'service_role' })
      const comps = [{ type: 'plugin', slug: 'woocommerce/woocommerce.php', name: 'WooCommerce', version: '9.0', latest_version: '9.1', update_available: true, active: true },
                     { type: 'core', slug: 'wordpress', name: 'WordPress', version: '7.1.2', latest_version: null, update_available: false, active: true }]
      await db.query(`select public.ingest_heartbeat($1, $2, $3)`, [site, { connector_version: '2.0.0', wp_version: '7.1.2', php_version: '8.3.1', memory_limit_mb: 256 }, JSON.stringify(comps)])
      const list = await db.query(`select type, slug, update_available from public.site_components where site_id = $1 order by slug`, [site])
      expect(list.rows).toEqual([
        { type: 'plugin', slug: 'woocommerce/woocommerce.php', update_available: true },
        { type: 'core', slug: 'wordpress', update_available: false },
      ])  // akismet (uit de seed) is verwijderd omdat de heartbeat hem niet meer meldt
      const s = await db.query(`select status, wp_version, php_version from public.sites where id = $1`, [site])
      expect(s.rows[0]).toEqual({ status: 'online', wp_version: '7.1.2', php_version: '8.3.1' })
    }))
})

describe('peek_invitation', () => {
  it('toont alleen de uitnodiging bij het juiste token, ook voor anon', () =>
    inTx(async db => {
      const [a] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.owner })
      const { rows: [{ t }] } = await db.query<{ t: string }>(`select public.invite_member('gast@example.test', 'member') t`)
      await actAs(db, { role: 'anon' })
      const ok = await db.query(`select * from public.peek_invitation($1)`, [t])
      expect(ok.rows).toEqual([{ agency_name: 'Bureau a', email: 'gast@example.test', role: 'member', valid: true }])
      const bad = await db.query(`select * from public.peek_invitation($1)`, ['0'.repeat(48)])
      expect(bad.rows).toEqual([])
    }))
})

describe('list_members', () => {
  it('geeft alleen leden van het eigen bureau (met e-mail), nooit die van B', () =>
    inTx(async db => {
      const [a, b] = await twoAgencies(db)
      await actAs(db, { role: 'authenticated', ...a.member })
      const r = await db.query<{ email: string; role: string }>(`select email, role from public.list_members()`)
      expect(r.rows.map(x => x.role)).toEqual(['owner', 'admin', 'member'])
      expect(r.rows.map(x => x.email).sort()).toEqual([a.owner.email, a.admin.email, a.member.email].sort())
      expect(r.rows.some(x => [b.owner.email, b.admin.email, b.member.email].includes(x.email))).toBe(false)
      await actAs(db, { role: 'anon' })
      expect((await expectError(db, `select * from public.list_members()`)).code).toBe('42501')
    }))
})
