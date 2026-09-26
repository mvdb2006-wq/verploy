import { describe, expect, it } from 'vitest'
import { customerStatus, customersCsv, kpis, toCustomer, type CustomerRow } from './customers'

const now = new Date('2026-09-26T12:00:00Z')
const base: CustomerRow = {
  id: 'a', name: 'Bureau A', created_at: '2026-09-20T10:00:00Z', locale: 'nl', owner_email: 'a@x.nl', members: 1, last_sign_in_at: null,
  plan_id: 'solo', plan_name: 'Solo', price_cents: 1900, sites_limit: 5, plan_status: 'trialing', trial_ends_at: '2026-10-01T00:00:00Z',
  period_end: null, cancel_at_end: false, stripe_customer_id: null, stripe_subscription_id: null, stripe_synced_at: null, sites: 1, sites_connected: 1,
}
const paid = { ...base, plan_status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', period_end: '2026-10-20T00:00:00Z' }

describe('customerStatus', () => {
  it('proef, verlopen proef, gratis, gestopt', () => {
    expect(customerStatus(base, null, now)).toBe('trial')
    expect(customerStatus({ ...base, trial_ends_at: '2026-09-01T00:00:00Z' }, null, now)).toBe('trial_ended')
    expect(customerStatus({ ...base, plan_status: 'comped' }, null, now)).toBe('free')
    expect(customerStatus({ ...paid, plan_status: 'canceled', stripe_subscription_id: null }, null, now)).toBe('stopped')
  })
  it('actief, opgezegd (loopt af), te laat via status of via een verlopen openstaande factuur', () => {
    expect(customerStatus(paid, null, now)).toBe('active')
    expect(customerStatus({ ...paid, cancel_at_end: true }, null, now)).toBe('cancels')
    expect(customerStatus({ ...paid, plan_status: 'past_due' }, null, now)).toBe('late')
    const overdue = { lastInvoice: { status: 'open', amountCents: 2299, date: '2026-09-10T00:00:00Z', dueDate: '2026-09-20T00:00:00Z', url: null, attempts: 2, nextAttempt: null } }
    expect(customerStatus(paid, overdue, now)).toBe('late')
    expect(customerStatus(paid, { lastInvoice: { ...overdue.lastInvoice, dueDate: '2026-10-01T00:00:00Z' } }, now)).toBe('active')
  })
})

describe('MRR en KPI', () => {
  it('MRR alleen voor betalende klanten, met korting (FOUNDING40)', () => {
    expect(toCustomer(base, null, now).mrrCents).toBe(0)
    expect(toCustomer(paid, null, now).mrrCents).toBe(1900)
    expect(toCustomer(paid, { percentOff: 40, couponName: 'FOUNDING40' }, now).mrrCents).toBe(1140)
  })
  it('tellingen bovenaan', () => {
    const list = [
      toCustomer(base, null, now),
      toCustomer({ ...base, id: 'b', trial_ends_at: '2026-10-20T00:00:00Z' }, null, now),
      toCustomer(paid, null, now),
      toCustomer({ ...paid, id: 'd', plan_status: 'past_due', price_cents: 4900 }, null, now),
      toCustomer({ ...paid, id: 'e', plan_status: 'canceled', stripe_subscription_id: null, stripe_synced_at: '2026-09-05T00:00:00Z' }, null, now),
    ]
    expect(kpis(list, 3, now)).toEqual({ paying: 2, trials: 2, trialsEndingThisWeek: 1, late: 1, mrrCents: 6800, stoppedThisMonth: 1, noAgency: 3 })
  })
  it('CSV: puntkomma, bedragen met komma, aanhalingstekens waar nodig', () => {
    const csv = customersCsv([toCustomer({ ...paid, name: 'Bureau; "B"' }, null, now)], s => s)
    expect(csv.split('\n')[0]).toBe('Bureau;E-mail;Plan;Status;MRR (excl. btw);Volgende factuur;Sites;Limiet;Klant sinds;Stripe-klant')
    expect(csv.split('\n')[1]).toBe('"Bureau; ""B""";a@x.nl;Solo;active;19,00;2026-10-20;1;5;2026-09-20;cus_1')
  })
})
