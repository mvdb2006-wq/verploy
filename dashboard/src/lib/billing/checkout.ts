import type Stripe from 'stripe'

/**
 * Parameters voor Stripe Checkout (eerste abonnement). De prijs komt uit het plan in de database,
 * nooit uit het formulier of de URL; het plan staat ook in de metadata (terugvinden in Stripe).
 *
 * EM Hosting & Design is zelf de verkoper (geen Stripe Managed Payments): btw via Stripe Tax, prijzen
 * exclusief btw. 21% in Nederland; verlegd bij een EU-bedrijf met geldig btw-nummer (tax_id_collection).
 */
export function checkoutSessionParams(o: {
  agencyId: string; customer: string; plan: { id: string; stripe_price_id: string }; locale: Stripe.Checkout.SessionCreateParams.Locale; appUrl: string
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'subscription',
    customer: o.customer,
    client_reference_id: o.agencyId,
    line_items: [{ price: o.plan.stripe_price_id, quantity: 1 }],
    subscription_data: { metadata: { agency_id: o.agencyId, plan: o.plan.id } },
    metadata: { agency_id: o.agencyId, plan: o.plan.id },
    allow_promotion_codes: true,
    managed_payments: { enabled: false },
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
    locale: o.locale,
    success_url: `${o.appUrl}/settings/billing?checkout=success`,
    cancel_url: `${o.appUrl}/settings/billing`,
  }
}
