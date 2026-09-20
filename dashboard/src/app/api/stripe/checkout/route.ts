import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe, getPriceId, type PlanId, type BillingInterval } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { plan, interval = 'monthly' } = body as {
      plan: PlanId
      interval: BillingInterval
    }

    if (!plan || !['starter', 'agency', 'pro'].includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    // Get or create Stripe customer
    const { data: agency } = await supabase
      .from('agencies')
      .select('id, name, stripe_customer_id')
      .eq('id', (await supabase
        .from('agency_members')
        .select('agency_id')
        .eq('user_id', user.id)
        .single()
      ).data?.agency_id)
      .single()

    if (!agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
    }

    let customerId = agency.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: agency.name,
        metadata: {
          agency_id: agency.id,
          user_id: user.id,
        },
      })
      customerId = customer.id

      await supabase
        .from('agencies')
        .update({ stripe_customer_id: customerId })
        .eq('id', agency.id)
    }

    const priceId = getPriceId(plan, interval)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL!

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card', 'ideal', 'sepa_debit'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${appUrl}/dashboard?upgrade=success&plan=${plan}`,
      cancel_url:  `${appUrl}/settings/billing?upgrade=cancelled`,
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          agency_id: agency.id,
          plan,
        },
      },
      metadata: {
        agency_id: agency.id,
        plan,
        interval,
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      tax_id_collection: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[stripe/checkout] error:', err)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
