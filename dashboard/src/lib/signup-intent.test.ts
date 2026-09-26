import { describe, expect, it } from 'vitest'
import { entryLocale, normalizePlanParam, pickPlan } from './signup-intent'
import { checkoutSessionParams } from './billing/checkout'

const PLANS = [{ id: 'solo' }, { id: 'studio' }, { id: 'agency' }, { id: 'scale' }]

describe('plan uit de URL (?plan=)', () => {
  it('geldig plan: alleen bestaande, openbare plannen; hoofdletters/spaties maken niet uit', () => {
    for (const id of ['solo', 'studio', 'agency', 'scale']) expect(pickPlan(id, PLANS)?.id).toBe(id)
    expect(pickPlan(' Agency ', PLANS)?.id).toBe('agency')
  })
  it('ongeldig plan: geen keuze, geen fout', () => {
    for (const v of ['enterprise', 'agency;drop', '../x', '<script>', 'a'.repeat(40), '1solo']) expect(pickPlan(v, PLANS)).toBeNull()
  })
  it('ontbrekend plan: geen keuze', () => {
    for (const v of [undefined, null, '', 42, ['agency']]) expect(pickPlan(v, PLANS)).toBeNull()
    expect(normalizePlanParam(undefined)).toBeNull()
  })
  it('verborgen plannen (niet openbaar) worden niet gekozen', () => {
    expect(pickPlan('comped', PLANS)).toBeNull()
  })
})

describe('taal van het instappunt', () => {
  it('?lang= wint (ook als "en-GB"); onbekende taal telt niet', () => {
    expect(entryLocale('en', null)).toBe('en')
    expect(entryLocale('en-GB', 'https://verploy.com/pricing/')).toBe('en')
    expect(entryLocale('de', 'https://verploy.com/')).toBe('de')
    expect(entryLocale('xx', null)).toBeNull()
  })
  it('van de Engelstalige marketingsite → Engels', () => {
    expect(entryLocale(null, 'https://verploy.com/start/?plan=studio')).toBe('en')
    expect(entryLocale(undefined, 'https://www.verploy.com/')).toBe('en')
  })
  it('geen context → bestaande logica (null): andere sites, de app zelf, ongeldige referer', () => {
    expect(entryLocale(null, null)).toBeNull()
    expect(entryLocale(null, 'https://app.verploy.com/login')).toBeNull()
    expect(entryLocale(null, 'https://verploy.com.evil.example/')).toBeNull()
    expect(entryLocale(null, 'geen url')).toBeNull()
  })
})

describe('checkout', () => {
  it('prijs komt uit het plan in de database; plan in de metadata', () => {
    const p = checkoutSessionParams({ agencyId: 'a1', customer: 'cus_1', plan: { id: 'agency', stripe_price_id: 'price_agency' }, locale: 'en', appUrl: 'https://app.verploy.com' })
    expect(p.managed_payments).toEqual({ enabled: false })   // zelf verkoper, geen 3,5% Managed Payments
    expect(p.automatic_tax).toEqual({ enabled: true })          // btw via Stripe Tax
    expect(p.line_items).toEqual([{ price: 'price_agency', quantity: 1 }])
    expect(p).toMatchObject({ mode: 'subscription', customer: 'cus_1', client_reference_id: 'a1', locale: 'en', metadata: { agency_id: 'a1', plan: 'agency' } })
  })
})
