/**
 * Klantoverzicht voor de beheerder van Verploy. De app-database (via de Stripe-webhook bijgewerkt) is
 * leidend; Stripe zelf levert aanvullend de laatste factuur en een eventuele korting (FOUNDING40).
 * Puur: geen I/O, zodat de regels (status, MRR, "te laat") te testen zijn.
 */
import type { Locale, MessageKey, Translate } from '@/lib/i18n/core'
import { formatDate } from '@/lib/format'

export type CustomerStatus = 'trial' | 'trial_ended' | 'active' | 'late' | 'cancels' | 'stopped' | 'free'

export interface CustomerRow {
  id: string; name: string; created_at: string; locale: string
  owner_email: string | null; members: number; last_sign_in_at: string | null
  plan_id: string; plan_name: string; price_cents: number; sites_limit: number
  plan_status: string; trial_ends_at: string | null; period_end: string | null; cancel_at_end: boolean
  stripe_customer_id: string | null; stripe_subscription_id: string | null; stripe_synced_at: string | null
  sites: number; sites_connected: number
}

/** Uit Stripe: laatste factuur en korting per klant (ontbreekt als Stripe niet bereikbaar is). */
export interface StripeFacts {
  lastInvoice?: { status: string; amountCents: number; date: string; dueDate: string | null; url: string | null; attempts: number; nextAttempt: string | null } | null
  percentOff?: number | null
  couponName?: string | null
}

export interface Customer extends CustomerRow {
  status: CustomerStatus
  mrrCents: number
  paying: boolean
  stripe: StripeFacts | null
}

/** Status in Verploy-taal. "Te laat" ook als de laatste factuur openstaat en de vervaldatum voorbij is. */
export function customerStatus(r: CustomerRow, s: StripeFacts | null, now = new Date()): CustomerStatus {
  if (r.plan_status === 'comped') return 'free'
  if (r.plan_status === 'trialing') return r.trial_ends_at && new Date(r.trial_ends_at) > now ? 'trial' : 'trial_ended'
  if (r.plan_status === 'canceled' || !r.stripe_subscription_id) return 'stopped'
  const inv = s?.lastInvoice
  const overdue = inv && (inv.status === 'open' || inv.status === 'uncollectible') && inv.dueDate && new Date(inv.dueDate) < now
  if (r.plan_status === 'past_due' || overdue) return 'late'
  return r.cancel_at_end ? 'cancels' : 'active'
}

export function toCustomer(r: CustomerRow, s: StripeFacts | null, now = new Date()): Customer {
  const status = customerStatus(r, s, now)
  const paying = status === 'active' || status === 'late' || status === 'cancels'
  const discount = s?.percentOff ? (100 - s.percentOff) / 100 : 1
  return { ...r, status, paying, stripe: s, mrrCents: paying ? Math.round(r.price_cents * discount) : 0 }
}

export interface Kpis { paying: number; trials: number; trialsEndingThisWeek: number; late: number; mrrCents: number; stoppedThisMonth: number; noAgency: number }

export function kpis(list: Customer[], looseUsers: number, now = new Date()): Kpis {
  const week = now.getTime() + 7 * 86_400_000
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return {
    paying: list.filter(c => c.paying).length,
    trials: list.filter(c => c.status === 'trial').length,
    trialsEndingThisWeek: list.filter(c => c.status === 'trial' && c.trial_ends_at && new Date(c.trial_ends_at).getTime() <= week).length,
    late: list.filter(c => c.status === 'late').length,
    mrrCents: list.reduce((sum, c) => sum + c.mrrCents, 0),
    stoppedThisMonth: list.filter(c => (c.status === 'stopped' || c.status === 'cancels') && c.stripe_synced_at && new Date(c.stripe_synced_at).getTime() >= monthStart).length,
    noAgency: looseUsers,
  }
}

/** CSV voor de eigen administratie (puntkomma, zoals Excel in NL verwacht; bedragen excl. btw in euro). */
export function customersCsv(list: Customer[], statusLabel: (s: CustomerStatus) => string): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['Bureau', 'E-mail', 'Plan', 'Status', 'MRR (excl. btw)', 'Volgende factuur', 'Sites', 'Limiet', 'Klant sinds', 'Stripe-klant']
  const rows = list.map(c => [
    c.name, c.owner_email, c.plan_name, statusLabel(c.status), (c.mrrCents / 100).toFixed(2).replace('.', ','),
    c.paying && c.period_end ? c.period_end.slice(0, 10) : '', c.sites, c.sites_limit, c.created_at.slice(0, 10), c.stripe_customer_id,
  ])
  return [head, ...rows].map(r => r.map(esc).join(';')).join('\n') + '\n'
}

/** De status als tekst ("Proef t/m 10 okt. 2026", "Te laat", …). */
export function statusText(t: Translate, locale: Locale, c: Pick<Customer, 'status' | 'trial_ends_at'>): string {
  return c.status === 'trial' ? t('admin.status.trial', { date: formatDate(c.trial_ends_at, locale) }) : t(`admin.status.${c.status}` as MessageKey)
}
