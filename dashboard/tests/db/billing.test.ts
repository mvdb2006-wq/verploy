import { afterAll, describe, expect, it } from 'vitest'
import { actAs, asSuper, expectError, inTx, pool, seedAgency, type Db } from './helpers'

afterAll(() => pool.end())

const T = (s: string) => new Date(`2026-09-${s}Z`).toISOString()

async function apply(db: Db, args: { id: string; created: string; agency: string; customer?: string; sub?: string; price?: string | null; status: string; end?: string; cancel?: boolean }) {
  await actAs(db, { role: 'service_role' })
  const r = await db.query(`select public.apply_stripe_subscription($1, 'customer.subscription.updated', $2, $3, $4, $5, $6, $7, $8, $9) as applied`,
    [args.id, args.created, args.agency, args.customer ?? 'cus_1', args.sub ?? 'sub_1', args.price === undefined ? 'price_agency' : args.price, args.status, args.end ?? T('30T00:00:00'), args.cancel ?? false])
  await asSuper(db)
  return r.rows[0].applied as boolean
}

async function withPrices(db: Db) {
  await asSuper(db)
  for (const [plan, price] of [['solo', 'price_solo'], ['studio', 'price_studio'], ['agency', 'price_agency'], ['scale', 'price_scale']]) {
    await db.query(`update public.plans set stripe_price_id = $2 where id = $1`, [plan, price])
  }
}

describe('Stripe-abonnement → bureau', () => {
  it('actief abonnement zet plan, status, klant en periode; zelfde event nogmaals doet niets', () =>
    inTx(async db => {
      await withPrices(db)
      const a = await seedAgency(db, 'bill', { planStatus: 'trialing', trialEndsAt: '2099-01-01T00:00:00Z' })
      await db.query(`update public.agencies set trial_ends_at = now() - interval '1 day' where id = $1`, [a.id])
      expect((await db.query(`select app.agency_is_writable($1) as w`, [a.id])).rows[0].w).toBe(false)
      expect(await apply(db, { id: 'evt_1', created: T('10T10:00:00'), agency: a.id, status: 'active' })).toBe(true)
      expect(await apply(db, { id: 'evt_1', created: T('10T10:00:00'), agency: a.id, status: 'canceled' })).toBe(false)
      const r = await db.query(`select plan_id, plan_status, stripe_customer_id, stripe_subscription_id, subscription_cancel_at_end from public.agencies where id = $1`, [a.id])
      expect(r.rows[0]).toEqual({ plan_id: 'agency', plan_status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', subscription_cancel_at_end: false })
      // verlopen proef is nu weer schrijfbaar
      expect((await db.query(`select app.agency_is_writable($1) as w`, [a.id])).rows[0].w).toBe(true)
    }))

  it('ouder event na een nieuwer wordt genegeerd (volgorde niet gegarandeerd)', () =>
    inTx(async db => {
      await withPrices(db)
      const a = await seedAgency(db, 'order')
      await apply(db, { id: 'evt_new', created: T('12T10:00:00'), agency: a.id, status: 'active', price: 'price_scale' })
      expect(await apply(db, { id: 'evt_old', created: T('11T10:00:00'), agency: a.id, status: 'active', price: 'price_solo' })).toBe(false)
      expect((await db.query(`select plan_id from public.agencies where id = $1`, [a.id])).rows[0].plan_id).toBe('scale')
    }))

  it('opzeggen aan einde periode, betaalachterstand blijft schrijfbaar, beëindigd = alleen-lezen', () =>
    inTx(async db => {
      await withPrices(db)
      const a = await seedAgency(db, 'end')
      await apply(db, { id: 'e1', created: T('01T00:00:00'), agency: a.id, status: 'active', cancel: true })
      expect((await db.query(`select subscription_cancel_at_end from public.agencies where id = $1`, [a.id])).rows[0].subscription_cancel_at_end).toBe(true)
      await apply(db, { id: 'e2', created: T('02T00:00:00'), agency: a.id, status: 'past_due' })
      expect((await db.query(`select plan_status, app.agency_is_writable(id) as w from public.agencies where id = $1`, [a.id])).rows[0]).toEqual({ plan_status: 'past_due', w: true })
      await apply(db, { id: 'e3', created: T('03T00:00:00'), agency: a.id, status: 'canceled' })
      const r = await db.query(`select plan_status, stripe_subscription_id, subscription_cancel_at_end, app.agency_is_writable(id) as w from public.agencies where id = $1`, [a.id])
      expect(r.rows[0]).toEqual({ plan_status: 'canceled', stripe_subscription_id: null, subscription_cancel_at_end: false, w: false })
      // alleen-lezen: geen nieuwe sites (trigger) en geen update-runs
      await expectError(db, `insert into public.sites (agency_id, name, url) values ($1, 'x', 'https://x-${Date.now()}.example')`, [a.id])
    }))

  it('incomplete verandert niets; onbekende prijs en andere klant worden geweigerd', () =>
    inTx(async db => {
      await withPrices(db)
      const a = await seedAgency(db, 'inc', { planStatus: 'trialing', trialEndsAt: '2099-01-01T00:00:00Z' })
      await apply(db, { id: 'i1', created: T('01T00:00:00'), agency: a.id, status: 'incomplete' })
      expect((await db.query(`select plan_status from public.agencies where id = $1`, [a.id])).rows[0].plan_status).toBe('trialing')
      await actAs(db, { role: 'service_role' })
      expect((await expectError(db, `select public.apply_stripe_subscription('i2', 't', now(), $1, 'cus_1', 'sub_1', 'price_onbekend', 'active', null, false)`, [a.id])).message).toBe('unknown_price')
      expect((await expectError(db, `select public.apply_stripe_subscription('i3', 't', now(), $1, 'cus_ANDER', 'sub_1', 'price_solo', 'active', null, false)`, [a.id])).message).toBe('customer_mismatch')
      // een mislukte verwerking telt niet als verwerkt: Stripe mag het opnieuw sturen
      expect((await db.query(`select count(*)::int n from public.stripe_events where id in ('i2','i3')`)).rows[0].n).toBe(0)
      await asSuper(db)
    }))

  it('gratis bureau blijft gratis bij een opgezegd abonnement', () =>
    inTx(async db => {
      await withPrices(db)
      const a = await seedAgency(db, 'comp', { planStatus: 'comped' })
      await apply(db, { id: 'c1', created: T('01T00:00:00'), agency: a.id, status: 'canceled' })
      expect((await db.query(`select plan_status from public.agencies where id = $1`, [a.id])).rows[0].plan_status).toBe('comped')
    }))

  it('gebruikers kunnen de Stripe-functies niet aanroepen of de billingkolommen wijzigen', () =>
    inTx(async db => {
      const a = await seedAgency(db, 'user')
      await actAs(db, { role: 'authenticated', ...a.owner })
      expect((await expectError(db, `select public.apply_stripe_subscription('x', 't', now(), $1, null, null, null, 'active', null, false)`, [a.id])).code).toBe('42501')
      expect((await expectError(db, `select public.set_plan_price('solo', 'price_x')`)).code).toBe('42501')
      expect((await expectError(db, `update public.agencies set plan_status = 'active', subscription_period_end = now() where id = $1`, [a.id])).code).toBe('42501')
      expect((await expectError(db, `select * from public.stripe_events`)).code).toBe('42501')
    }))
})
