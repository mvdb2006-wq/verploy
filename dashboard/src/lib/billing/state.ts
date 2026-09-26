import type { Tables } from '@/lib/database.types'

/**
 * Eén bron van waarheid voor wat het abonnementsscherm toont: de status (banner) en welk plan "Huidig" is.
 * De stand in de database volgt Stripe via de webhook (apply_stripe_subscription). Een plan is alleen
 * "Huidig" bij een lopend Stripe-abonnement; een gratis account of proefperiode heeft geen huidig plan.
 */
export type BillingState =
  | { kind: 'comped'; sitesLimit: number | null }
  | { kind: 'trial'; endsAt: string | null }
  | { kind: 'trial_ended' }
  | { kind: 'active'; planId: string; renewsAt: string | null }
  | { kind: 'cancels'; planId: string; endsAt: string }
  | { kind: 'past_due'; planId: string }
  | { kind: 'canceled' }

type Agency = Pick<Tables<'agencies'>, 'plan_id' | 'plan_status' | 'trial_ends_at' | 'stripe_subscription_id' | 'subscription_period_end' | 'subscription_cancel_at_end'>

export function billingState(a: Agency, plans: { id: string; sites_limit: number }[] = [], now = new Date()): BillingState {
  const subscribed = Boolean(a.stripe_subscription_id)
  switch (a.plan_status) {
    case 'comped':
      return { kind: 'comped', sitesLimit: plans.find(p => p.id === a.plan_id)?.sites_limit ?? null }
    case 'trialing':
      return a.trial_ends_at && new Date(a.trial_ends_at) > now ? { kind: 'trial', endsAt: a.trial_ends_at } : { kind: 'trial_ended' }
    case 'past_due':
      return subscribed ? { kind: 'past_due', planId: a.plan_id } : { kind: 'canceled' }
    case 'active':
      if (!subscribed) return { kind: 'canceled' }
      return a.subscription_cancel_at_end && a.subscription_period_end
        ? { kind: 'cancels', planId: a.plan_id, endsAt: a.subscription_period_end }
        : { kind: 'active', planId: a.plan_id, renewsAt: a.subscription_period_end }
    default:
      return { kind: 'canceled' }
  }
}

/** Het plan met de markering "Huidig": alleen bij een lopend (betaald) abonnement. */
export function currentPlanId(s: BillingState): string | null {
  return s.kind === 'active' || s.kind === 'cancels' || s.kind === 'past_due' ? s.planId : null
}

/** Kan de eigenaar een (ander) plan kiezen, en via Checkout of via wijzigen? */
export function planAction(s: BillingState): 'checkout' | 'change' | null {
  if (s.kind === 'comped') return null
  return currentPlanId(s) ? 'change' : 'checkout'
}
