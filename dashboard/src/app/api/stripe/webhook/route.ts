import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/server'
import type Stripe from 'stripe'

// Plan mapping from Stripe price metadata
const PLAN_LIMITS: Record<string, { plan: string; sites: number }> = {
  starter: { plan: 'starter', sites: 10 },
  agency:  { plan: 'agency',  sites: 50 },
  pro:     { plan: 'pro',     sites: 2147483647 },
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const headersList = await headers()
  const sig = headersList.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createServiceClient()

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.CheckoutSession
        const agencyId = session.metadata?.agency_id
        const plan = session.metadata?.plan

        if (!agencyId || !plan) break

        const planData = PLAN_LIMITS[plan]
        if (!planData) break

        await supabase
          .from('agencies')
          .update({
            plan: planData.plan,
            plan_sites_limit: planData.sites,
            stripe_subscription_id: session.subscription as string,
            stripe_customer_id: session.customer as string,
            trial_ends_at: null,
            subscription_ends_at: null,
          })
          .eq('id', agencyId)

        console.log(`[stripe/webhook] Agency ${agencyId} upgraded to ${plan}`)
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const agencyId = sub.metadata?.agency_id

        if (!agencyId) {
          // Look up agency by customer ID
          const { data: agency } = await supabase
            .from('agencies')
            .select('id')
            .eq('stripe_customer_id', sub.customer as string)
            .single()
          if (!agency) break

          await handleSubscriptionChange(supabase, agency.id, sub)
        } else {
          await handleSubscriptionChange(supabase, agencyId, sub)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription

        const { data: agency } = await supabase
          .from('agencies')
          .select('id')
          .eq('stripe_subscription_id', sub.id)
          .single()

        if (agency) {
          await supabase
            .from('agencies')
            .update({
              plan: 'starter',
              plan_sites_limit: 10,
              stripe_subscription_id: null,
              subscription_ends_at: new Date(sub.current_period_end * 1000).toISOString(),
            })
            .eq('id', agency.id)

          console.log(`[stripe/webhook] Agency ${agency.id} subscription cancelled`)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        console.warn('[stripe/webhook] Payment failed for customer:', invoice.customer)
        // TODO: send email notification via Resend
        break
      }

      default:
        console.log(`[stripe/webhook] Unhandled event: ${event.type}`)
    }
  } catch (err) {
    console.error('[stripe/webhook] Handler error:', err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function handleSubscriptionChange(
  supabase: ReturnType<typeof createServiceClient>,
  agencyId: string,
  sub: Stripe.Subscription
) {
  const plan = sub.metadata?.plan || 'starter'
  const planData = PLAN_LIMITS[plan] || PLAN_LIMITS.starter

  const status = sub.status
  const isActive = ['active', 'trialing'].includes(status)

  await supabase
    .from('agencies')
    .update({
      plan: isActive ? planData.plan : 'starter',
      plan_sites_limit: isActive ? planData.sites : 10,
      trial_ends_at: sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null,
      subscription_ends_at: isActive
        ? null
        : new Date(sub.current_period_end * 1000).toISOString(),
    })
    .eq('id', agencyId)
}
