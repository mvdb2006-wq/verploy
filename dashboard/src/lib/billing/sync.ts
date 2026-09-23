import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

type Admin = SupabaseClient<Database>

export interface SubscriptionFacts {
  agencyId: string | null
  customer: string | null
  subscription: string
  price: string | null
  status: string
  periodEnd: string | null
  cancelAtEnd: boolean
}

const id = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : v?.id ?? null)

/** Haalt uit een Stripe-abonnement wat Verploy nodig heeft (API-versie 2026: periode per item). */
export function subscriptionFacts(sub: Stripe.Subscription): SubscriptionFacts {
  const item = sub.items?.data?.[0]
  return {
    agencyId: (sub.metadata?.agency_id as string | undefined) ?? null,
    customer: id(sub.customer as string | { id: string }),
    subscription: sub.id,
    price: item?.price?.id ?? null,
    status: sub.status,
    periodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    cancelAtEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at),
  }
}

export type WebhookOutcome = 'applied' | 'duplicate_or_stale' | 'ignored' | 'no_agency'

/** Verwerkt een (al geverifieerd) Stripe-event. Gooit bij een fout, zodat Stripe het opnieuw stuurt. */
export async function handleStripeEvent(admin: Admin, event: Stripe.Event): Promise<WebhookOutcome> {
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session
    const agency = s.client_reference_id ?? (s.metadata?.agency_id as string | undefined) ?? null
    const customer = id(s.customer as string | { id: string } | null)
    if (!agency || !customer) return 'ignored'
    const { error } = await admin.rpc('set_stripe_customer', { p_agency: agency, p_customer: customer })
    if (error) throw error
    return 'applied'
  }
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const f = subscriptionFacts(event.data.object as Stripe.Subscription)
    let agency = f.agencyId
    if (!agency && f.customer) {
      const { data } = await admin.from('agencies').select('id').eq('stripe_customer_id', f.customer).maybeSingle()
      agency = data?.id ?? null
    }
    if (!agency) return 'no_agency'
    const { data, error } = await admin.rpc('apply_stripe_subscription', {
      p_event_id: event.id, p_event_type: event.type, p_event_created: new Date(event.created * 1000).toISOString(),
      p_agency: agency, p_customer: f.customer, p_subscription: f.subscription, p_price: f.price,
      p_status: event.type === 'customer.subscription.deleted' ? 'canceled' : f.status,
      p_period_end: f.periodEnd, p_cancel_at_end: f.cancelAtEnd,
    })
    if (error) throw error
    return data ? 'applied' : 'duplicate_or_stale'
  }
  return 'ignored'
}
