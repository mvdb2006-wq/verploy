import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/billing/stripe'
import { handleStripeEvent } from '@/lib/billing/sync'
import { env } from '@/lib/env'

/** Stripe-webhook: handtekening controleren op de ruwe body, dan idempotent verwerken. */
export async function POST(req: NextRequest) {
  const s = stripe()
  const secret = env().STRIPE_WEBHOOK_SECRET
  if (!s || !secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  const signature = req.headers.get('stripe-signature')
  const raw = await req.text()
  if (!signature || raw.length > 1_000_000) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  let event
  try {
    event = s.webhooks.constructEvent(raw, signature, secret)
  } catch {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 })
  }
  try {
    const outcome = await handleStripeEvent(createAdminClient(), event)
    return NextResponse.json({ received: true, outcome })
  } catch (err) {
    console.error('[stripe] verwerken mislukt', event.id, event.type, (err as Error).message)
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
}
