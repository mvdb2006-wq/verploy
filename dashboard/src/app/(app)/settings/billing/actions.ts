'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireAgency } from '@/lib/session'
import { getLocale, getT } from '@/lib/i18n/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/billing/stripe'
import { env } from '@/lib/env'
import { checkoutSessionParams } from '@/lib/billing/checkout'

export interface BillingState { error?: string; ok?: string }

async function ownerContext() {
  const session = await requireAgency()
  const t = await getT()
  const s = stripe()
  if (session.role !== 'owner') return { error: t('billing.ownerOnly') } as const
  if (!s) return { error: t('billing.notConfigured') } as const
  return { session, t, s } as const
}

async function planFor(planId: string) {
  const supabase = await createClient()
  const { data } = await supabase.from('plans').select('id, name, sites_limit, stripe_price_id, is_public').eq('id', planId).maybeSingle()
  return data?.is_public && data.stripe_price_id ? data : null
}

async function siteCount(): Promise<number> {
  const supabase = await createClient()
  const { count } = await supabase.from('sites').select('id', { count: 'exact', head: true })
  return count ?? 0
}

const STRIPE_LOCALE = { nl: 'nl', en: 'en', de: 'de', fr: 'fr', es: 'es' } as const

/** Eerste abonnement: Stripe Checkout (kaart, iDEAL/SEPA via Stripe, btw-nummer). */
export async function startCheckout(_: BillingState, form: FormData): Promise<BillingState> {
  const c = await ownerContext()
  if ('error' in c) return { error: c.error }
  const { session, t, s } = c
  const plan = await planFor(String(form.get('plan') ?? ''))
  if (!plan) return { error: t('common.errorGeneric') }
  const used = await siteCount()
  if (used > plan.sites_limit) return { error: t('billing.overLimit', { used, plan: plan.name, limit: plan.sites_limit }) }
  const appUrl = env().NEXT_PUBLIC_APP_URL
  let url: string | null
  try {
    let customer = session.agency.stripe_customer_id
    if (!customer) {
      const created = await s.customers.create({ email: session.user.email, name: session.agency.name, metadata: { agency_id: session.agency.id } },
        { idempotencyKey: `customer-${session.agency.id}` })
      customer = created.id
      const { error } = await createAdminClient().rpc('set_stripe_customer', { p_agency: session.agency.id, p_customer: customer })
      if (error) throw error
    }
    const checkout = await s.checkout.sessions.create(checkoutSessionParams({
      agencyId: session.agency.id, customer, plan: { id: plan.id, stripe_price_id: plan.stripe_price_id! },
      locale: STRIPE_LOCALE[await getLocale()], appUrl,
    }))
    url = checkout.url
  } catch (err) {
    console.error('[billing] checkout mislukt', (err as Error).message)
    return { error: t('billing.error') }
  }
  if (!url) return { error: t('billing.error') }
  redirect(url)
}

/** Upgraden of downgraden van een bestaand abonnement (niet onder het huidige aantal sites). */
export async function changePlan(_: BillingState, form: FormData): Promise<BillingState> {
  const c = await ownerContext()
  if ('error' in c) return { error: c.error }
  const { session, t, s } = c
  const plan = await planFor(String(form.get('plan') ?? ''))
  const subId = session.agency.stripe_subscription_id
  if (!plan || !subId) return { error: t('common.errorGeneric') }
  const used = await siteCount()
  if (used > plan.sites_limit) return { error: t('billing.overLimit', { used, plan: plan.name, limit: plan.sites_limit }) }
  try {
    const sub = await s.subscriptions.retrieve(subId)
    const item = sub.items.data[0]
    if (!item) return { error: t('common.errorGeneric') }
    const supabase = await createClient()
    const { data: current } = await supabase.from('plans').select('price_cents').eq('id', session.agency.plan_id).single()
    const { data: target } = await supabase.from('plans').select('price_cents').eq('id', plan.id).single()
    const upgrade = (target?.price_cents ?? 0) > (current?.price_cents ?? 0)
    await s.subscriptions.update(subId, {
      items: [{ id: item.id, price: plan.stripe_price_id! }],
      // Upgrade: direct naar rato afrekenen. Downgrade: tegoed op de volgende factuur.
      proration_behavior: upgrade ? 'always_invoice' : 'create_prorations',
      cancel_at_period_end: false,
      metadata: { agency_id: session.agency.id },
    })
  } catch (err) {
    console.error('[billing] wijzigen mislukt', (err as Error).message)
    return { error: t('billing.error') }
  }
  revalidatePath('/settings/billing')
  return { ok: t('billing.changed') }
}

export async function setCancelAtPeriodEnd(_: BillingState, form: FormData): Promise<BillingState> {
  const c = await ownerContext()
  if ('error' in c) return { error: c.error }
  const { session, t, s } = c
  const subId = session.agency.stripe_subscription_id
  if (!subId) return { error: t('common.errorGeneric') }
  const cancel = form.get('cancel') === '1'
  try {
    await s.subscriptions.update(subId, { cancel_at_period_end: cancel })
  } catch (err) {
    console.error('[billing] opzeggen mislukt', (err as Error).message)
    return { error: t('billing.error') }
  }
  revalidatePath('/settings/billing')
  return { ok: t(cancel ? 'billing.canceled' : 'billing.resumed') }
}

/** Stripe-klantportaal: betaalmethode en facturen. */
export async function openPortal(): Promise<void> {
  const c = await ownerContext()
  if ('error' in c || !c.session.agency.stripe_customer_id) redirect('/settings/billing')
  const { session, s } = c as Exclude<typeof c, { error: string }>
  const configuration = env().STRIPE_PORTAL_CONFIGURATION
  const portal = await s.billingPortal.sessions.create({
    customer: session.agency.stripe_customer_id!, return_url: `${env().NEXT_PUBLIC_APP_URL}/settings/billing`,
    ...(configuration ? { configuration } : {}),
  })
  redirect(portal.url)
}
