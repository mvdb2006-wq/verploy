import { describe, expect, it } from 'vitest'
import { adviceFor, dependencyOrder, dependentsOf, dependsOn, isolatedFailure, itemOutcome, summarizeRun, type RunItem } from './run-items'

const p = (slug: string, name: string, over: Partial<RunItem> = {}): RunItem =>
  ({ type: 'plugin', slug: `${slug}/${slug}.php`, name, from_version: '1.0', to_version: '1.1', ...over })

const elementor = p('elementor', 'Elementor')
const elementorPro = p('elementor-pro', 'Elementor Pro')
const woo = p('woocommerce', 'WooCommerce')
const wooSubs = p('woocommerce-subscriptions', 'WooCommerce Subscriptions')
const stripe = p('checkout-stripe', 'Stripe for WooCommerce')
const cf7 = p('contact-form-7', 'Contact Form 7')
const cf7redirect = p('wpcf7-redirect', 'Redirection for Contact Form 7')
const wpbakery = p('js_composer', 'WPBakery Page Builder')
const yoast = p('wordpress-seo', 'Yoast SEO')

describe('isolatedFailure', () => {
  it('weigering vóóraf (geen pakket, download mislukt, …) → de rest gaat door', () => {
    for (const s of ['no_update_available', 'no_package', 'download_failed', 'not_a_zip', 'connector_outdated']) expect(isolatedFailure(s, '1.0', null)).toBe(true)
  })
  it('mislukte update: alleen als de oude versie aantoonbaar nog staat', () => {
    expect(isolatedFailure('update_failed', '8.7.3', '8.7.3')).toBe(true)
    expect(isolatedFailure('update_failed', '8.7.3', null)).toBe(false)       // plugin weg/kapot
    expect(isolatedFailure('update_failed', '8.7.3', '9.0.1')).toBe(false)    // wél gewijzigd
  })
  it('crash of onbekende status → hele run stopt', () => {
    expect(isolatedFailure('crashed', '1.0', '1.0')).toBe(false)
    expect(isolatedFailure('filesystem_not_writable', '1.0', null)).toBe(false)
  })
})

describe('afhankelijkheden', () => {
  it('uitbreidingen en add-ons hangen af van hun basis', () => {
    expect(dependsOn(elementorPro, elementor)).toBe(true)
    expect(dependsOn(wooSubs, woo)).toBe(true)
    expect(dependsOn(stripe, woo)).toBe(true)
    expect(dependsOn(cf7redirect, cf7)).toBe(true)
    expect(dependsOn(p('wordpress-seo-premium', 'Yoast SEO Premium'), yoast)).toBe(true)
    expect(dependsOn(p('avada-child', 'Avada Child', { type: 'theme', slug: 'avada-child' }), p('avada', 'Avada', { type: 'theme', slug: 'avada' }))).toBe(true)
  })
  it('geen verband → onafhankelijk (ook niet andersom)', () => {
    expect(dependsOn(elementor, elementorPro)).toBe(false)
    expect(dependsOn(yoast, wpbakery)).toBe(false)
    expect(dependsOn(cf7, woo)).toBe(false)
    expect(dependsOn(elementor, { type: 'core', slug: 'wordpress', name: 'WordPress', from_version: '6.8', to_version: '6.9' })).toBe(false)
  })
  it('transitief, en de basis komt eerst', () => {
    const addon = p('woocommerce-subscriptions-gifting', 'Gifting for WooCommerce Subscriptions')
    expect(dependentsOf(woo, [wooSubs, addon, yoast, woo]).map(i => i.name)).toEqual(['WooCommerce Subscriptions', 'Gifting for WooCommerce Subscriptions'])
    expect(dependencyOrder([elementorPro, yoast, elementor]).map(i => i.name)).toEqual(['Yoast SEO', 'Elementor', 'Elementor Pro'])
  })
})

describe('uitkomst per onderdeel', () => {
  const done = (verdict: string) => ({ status: 'done', verdict })
  it('14 van 15 live, WPBakery vraagt aandacht', () => {
    const items: RunItem[] = [
      ...Array.from({ length: 14 }, (_, n) => p(`plugin-${n}`, `Plugin ${n}`, { staging: 'updated', production: 'updated' })),
      { ...wpbakery, staging: 'no_update_available' },
    ]
    const s = summarizeRun(items, done('deployed'))
    expect(s.live).toHaveLength(14)
    expect(s.attention.map(i => i.name)).toEqual(['WPBakery Page Builder'])
    expect(s.liveTouched).toBe(true)
  })
  it('overgeslagen afhankelijke, tegengehouden run, teruggezet', () => {
    expect(itemOutcome({ ...elementorPro, staging: 'skipped_dependency' }, done('deployed'))).toBe('skipped_dependent')
    expect(itemOutcome({ ...yoast, staging: 'updated' }, done('blocked'))).toBe('held_back')
    expect(itemOutcome({ ...yoast, staging: 'updated', production: 'updated' }, done('rolled_back'))).toBe('rolled_back')
    expect(itemOutcome({ ...yoast, staging: 'updated' }, { status: 'staging_test', verdict: null })).toBe('pending')
    expect(itemOutcome({ ...yoast, staging: 'already_current', production: 'already_current' }, done('deployed'))).toBe('current')
  })
  it('advies per oorzaak', () => {
    expect(adviceFor('no_update_available')).toBe('licence')
    expect(adviceFor('download_failed')).toBe('retry')
    expect(adviceFor('skipped_dependency')).toBe('dependency')
    expect(adviceFor('update_failed')).toBe('review')
  })
})
