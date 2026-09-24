import { describe, expect, it } from 'vitest'
import { TEST_VALUES, compareFunctional, valueFor, type FnResult } from './functional'

describe('valueFor', () => {
  it('kiest een passende testwaarde per veld', () => {
    expect(valueFor({ tag: 'input', type: 'email', name: 'your-email' })).toBe(TEST_VALUES.email)
    expect(valueFor({ tag: 'input', type: 'text', name: 'your-email' })).toBe(TEST_VALUES.email)       // e-mail in een tekstveld
    expect(valueFor({ tag: 'input', type: 'text', name: 'your-name' })).toBe(TEST_VALUES.name)
    expect(valueFor({ tag: 'input', type: 'tel', name: 'x' })).toBe(TEST_VALUES.tel)
    expect(valueFor({ tag: 'input', type: 'number', name: 'aantal', min: '2' })).toBe('2')
    expect(valueFor({ tag: 'textarea', type: '', name: 'your-message' })).toBe(TEST_VALUES.message)
    expect(valueFor({ tag: 'input', type: 'color', name: 'x' })).toBeNull()
  })
  it('testadres op een gereserveerd domein (nooit een echte ontvanger)', () => {
    expect(TEST_VALUES.email.endsWith('@example.com')).toBe(true)
  })
})

describe('compareFunctional', () => {
  const r = (over: Partial<FnResult>): FnResult => ({ key: 'form:post:7:cf7', kind: 'form', formKind: 'cf7', label: 'Contact', url: 'https://x/contact', outcome: 'ok', reason: 'sent', jsErrors: [], ...over })

  it('werkte vóór, werkt ná niet meer → blokkeren, met de reden', () => {
    expect(compareFunctional([r({})], [r({ outcome: 'failed', reason: 'submit_failed' })])).toEqual([
      { key: 'form:post:7:cf7', kind: 'form', formKind: 'cf7', label: 'Contact', url: 'https://x/contact', reason: 'submit_failed' },
    ])
    expect(compareFunctional([r({})], [r({ outcome: 'inconclusive', reason: 'validation' })])[0]!.reason).toBe('validation')
    expect(compareFunctional([r({})], [])[0]!.reason).toBe('not_rendered')
  })
  it('nieuwe JavaScript-fouten tijdens de handeling tellen; bestaande niet', () => {
    expect(compareFunctional([r({ jsErrors: ['oud'] })], [r({ jsErrors: ['oud', 'nieuw'] })])).toMatchObject([{ reason: 'js', errors: ['nieuw'] }])
    expect(compareFunctional([r({ jsErrors: ['oud'] })], [r({ jsErrors: ['oud'] })])).toEqual([])
  })
  it('wat vóór al niet werkte, overgeslagen of onduidelijk was, houdt niets tegen', () => {
    for (const outcome of ['failed', 'skipped', 'inconclusive'] as const) {
      expect(compareFunctional([r({ outcome })], [r({ outcome: 'failed', reason: 'no_response' })])).toEqual([])
    }
  })
  it('webwinkel: stap die niet meer lukt', () => {
    const shop = r({ key: 'shop', kind: 'shop', formKind: undefined, reason: 'checkout_reached' })
    expect(compareFunctional([shop], [{ ...shop, outcome: 'failed', reason: 'add_to_cart' }])).toMatchObject([{ kind: 'shop', reason: 'add_to_cart' }])
  })
})
