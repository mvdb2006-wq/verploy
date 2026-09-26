import 'server-only'
import type Stripe from 'stripe'
import type { StripeFacts } from './customers'

const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null)
const id = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : v?.id ?? null)

/**
 * Laatste factuur en korting per Stripe-klant, in twee API-aanroepen (de recente facturen en
 * abonnementen van het hele account). Genoeg voor het overzicht; per klant staat de volledige lijst in Stripe.
 */
export async function loadStripeFacts(s: Stripe): Promise<Map<string, StripeFacts>> {
  const out = new Map<string, StripeFacts>()
  const [invoices, subs] = await Promise.all([
    s.invoices.list({ limit: 100 }),
    s.subscriptions.list({ status: 'all', limit: 100, expand: ['data.discounts.source.coupon'] }),
  ])
  for (const inv of invoices.data) {   // nieuwste eerst
    const cust = id(inv.customer as string | { id: string } | null)
    if (!cust || out.get(cust)?.lastInvoice) continue
    out.set(cust, {
      ...out.get(cust),
      lastInvoice: {
        status: inv.status ?? 'draft', amountCents: inv.total ?? 0, date: iso(inv.created)!, dueDate: iso(inv.due_date),
        url: inv.hosted_invoice_url ?? null, attempts: inv.attempt_count ?? 0, nextAttempt: iso(inv.next_payment_attempt),
      },
    })
  }
  for (const sub of subs.data) {
    const cust = id(sub.customer as string | { id: string })
    if (!cust || out.get(cust)?.percentOff !== undefined) continue
    const coupon = (sub.discounts ?? [])
      .map(d => (typeof d === 'string' ? null : d.source?.coupon))
      .find((c): c is Stripe.Coupon => Boolean(c) && typeof c !== 'string')
    out.set(cust, { ...out.get(cust), percentOff: coupon?.percent_off ?? null, couponName: coupon?.name ?? coupon?.id ?? null })
  }
  return out
}
