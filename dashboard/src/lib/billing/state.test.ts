import { describe, expect, it } from 'vitest'
import { billingState, currentPlanId, planAction } from './state'

const now = new Date('2026-09-26T12:00:00Z')
const base = { plan_id: 'scale', plan_status: 'trialing', trial_ends_at: '2026-10-10T00:00:00Z', stripe_subscription_id: null, subscription_period_end: null, subscription_cancel_at_end: false }
const plans = [{ id: 'solo', sites_limit: 5 }, { id: 'scale', sites_limit: 120 }]

describe('billingState: één bron van waarheid voor banner en "Huidig"', () => {
  it('gratis account: geen huidig plan, wel de limiet; geen knoppen', () => {
    const s = billingState({ ...base, plan_status: 'comped' }, plans, now)
    expect(s).toEqual({ kind: 'comped', sitesLimit: 120 })
    expect(currentPlanId(s)).toBeNull()
    expect(planAction(s)).toBeNull()
  })
  it('proef (ook met plan_id uit de voorkeur): geen huidig plan; kiezen via Checkout', () => {
    const s = billingState(base, plans, now)
    expect(s).toEqual({ kind: 'trial', endsAt: '2026-10-10T00:00:00Z' })
    expect(currentPlanId(s)).toBeNull()
    expect(planAction(s)).toBe('checkout')
    expect(billingState({ ...base, trial_ends_at: '2026-09-01T00:00:00Z' }, plans, now).kind).toBe('trial_ended')
  })
  it('lopend Stripe-abonnement: dat plan is huidig; wisselen via change', () => {
    const s = billingState({ ...base, plan_id: 'solo', plan_status: 'active', stripe_subscription_id: 'sub_1', subscription_period_end: '2026-10-26T00:00:00Z' }, plans, now)
    expect(s).toEqual({ kind: 'active', planId: 'solo', renewsAt: '2026-10-26T00:00:00Z' })
    expect(currentPlanId(s)).toBe('solo')
    expect(planAction(s)).toBe('change')
  })
  it('opgezegd per einde periode, betaling mislukt, zonder abonnement', () => {
    expect(billingState({ ...base, plan_id: 'solo', plan_status: 'active', stripe_subscription_id: 'sub_1', subscription_period_end: '2026-10-26T00:00:00Z', subscription_cancel_at_end: true }, plans, now))
      .toEqual({ kind: 'cancels', planId: 'solo', endsAt: '2026-10-26T00:00:00Z' })
    expect(billingState({ ...base, plan_id: 'solo', plan_status: 'past_due', stripe_subscription_id: 'sub_1' }, plans, now)).toEqual({ kind: 'past_due', planId: 'solo' })
    // "Actief" zonder Stripe-abonnement bestaat niet: nooit een plan als huidig tonen dat niet betaald wordt.
    const orphan = billingState({ ...base, plan_status: 'active' }, plans, now)
    expect(orphan.kind).toBe('canceled')
    expect(currentPlanId(orphan)).toBeNull()
  })
})
