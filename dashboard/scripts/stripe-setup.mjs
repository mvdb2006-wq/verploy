// Richt Stripe in vanuit de plans-tabel (de enige plek voor prijzen en limieten). Idempotent:
//  • product "Verploy" (vast id), per plan een maandprijs met lookup_key verploy_<plan>_monthly
//    (bij een gewijzigde prijs: nieuwe prijs, lookup_key wordt overgezet, oude prijs gearchiveerd)
//  • price-id's terug in plans.stripe_price_id
//  • klantportaal-configuratie (betaalmethode, facturen, factuurgegevens) en de webhook
//
// Gebruik: node --env-file=.env.local scripts/stripe-setup.mjs [--webhook-url https://app.verploy.com/api/stripe/webhook]
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const key = process.env.STRIPE_SECRET_KEY
if (!key) { console.error('STRIPE_SECRET_KEY ontbreekt'); process.exit(1) }
const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null
const stripe = new Stripe(key, base ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(':', '') } : {})
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const webhookUrl = process.argv.includes('--webhook-url') ? process.argv[process.argv.indexOf('--webhook-url') + 1] : null

const PRODUCT_ID = 'verploy_subscription'
let product
try { product = await stripe.products.retrieve(PRODUCT_ID) } catch { product = null }
if (!product) product = await stripe.products.create({ id: PRODUCT_ID, name: 'Verploy', description: 'Veilige WordPress-updates, monitoring en rapporten voor webbureaus' })
console.log(`product: ${product.id}`)

const { data: plans, error } = await db.from('plans').select('id, name, price_cents, currency, sites_limit').eq('is_public', true).order('sort_order')
if (error) throw error
for (const p of plans) {
  const lookup = `verploy_${p.id}_monthly`
  const existing = (await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 })).data[0]
  let price = existing
  if (!existing || existing.unit_amount !== p.price_cents || existing.currency !== p.currency) {
    price = await stripe.prices.create({
      product: product.id, currency: p.currency, unit_amount: p.price_cents, recurring: { interval: 'month' },
      lookup_key: lookup, transfer_lookup_key: true, nickname: `${p.name} (${p.sites_limit} sites)`,
      metadata: { plan: p.id, sites_limit: String(p.sites_limit) }, tax_behavior: 'exclusive',
    })
    if (existing) await stripe.prices.update(existing.id, { active: false })
  }
  const { error: e } = await db.rpc('set_plan_price', { p_plan: p.id, p_price: price.id })
  if (e) throw e
  console.log(`${p.id}: ${price.id} (${p.price_cents / 100} ${p.currency}, ${p.sites_limit} sites)`)
}

const portal = await stripe.billingPortal.configurations.create({
  business_profile: { headline: 'Verploy' },
  features: {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id', 'name'] },
    subscription_cancel: { enabled: false },   // opzeggen gaat via Verploy (zelfde regels)
  },
})
console.log(`STRIPE_PORTAL_CONFIGURATION=${portal.id}`)

if (webhookUrl) {
  const events = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']
  const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find(w => w.url === webhookUrl)
  if (existing) {
    await stripe.webhookEndpoints.update(existing.id, { enabled_events: events })
    console.log(`webhook bestond al: ${existing.id} (geheim staat in het Stripe-dashboard)`)
  } else {
    const hook = await stripe.webhookEndpoints.create({ url: webhookUrl, enabled_events: events, description: 'Verploy abonnementen' })
    console.log(`STRIPE_WEBHOOK_SECRET=${hook.secret}`)
  }
}
