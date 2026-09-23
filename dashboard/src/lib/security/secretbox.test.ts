import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from './secretbox'

const derived = { serviceRoleKey: 'service-role-key-for-tests-0123456789' }
const primary = { primary: randomBytes(32).toString('base64'), serviceRoleKey: derived.serviceRoleKey }

describe('secretbox', () => {
  it('roundtrip met afgeleide sleutel (d1) en eigen sleutel (k1)', () => {
    const s = randomBytes(32).toString('hex')
    const d = encryptSecret(s, derived)
    const k = encryptSecret(s, primary)
    expect(d.startsWith('d1:')).toBe(true)
    expect(k.startsWith('k1:')).toBe(true)
    expect(decryptSecret(d, derived)).toBe(s)
    expect(decryptSecret(k, primary)).toBe(s)
  })

  it('oude d1-data blijft leesbaar nadat een eigen sleutel is ingesteld', () => {
    const d = encryptSecret('geheim', derived)
    expect(decryptSecret(d, primary)).toBe('geheim')
  })

  it('elke versleuteling is uniek (random IV) en bevat het geheim niet', () => {
    const a = encryptSecret('geheim', derived)
    const b = encryptSecret('geheim', derived)
    expect(a).not.toBe(b)
    expect(a).not.toContain('geheim')
  })

  it('manipulatie van ciphertext of tag wordt gedetecteerd', () => {
    const box = encryptSecret('geheim', derived)
    const parts = box.split(':')
    const flipped = Buffer.from(parts[2]!, 'base64url'); flipped[0]! ^= 1
    expect(() => decryptSecret([parts[0], parts[1], flipped.toString('base64url'), parts[3]].join(':'), derived)).toThrow()
    expect(() => decryptSecret(box, { serviceRoleKey: 'andere-sleutel-0123456789' })).toThrow()
  })

  it('k1 zonder geconfigureerde sleutel geeft een duidelijke fout', () => {
    const k = encryptSecret('x', primary)
    expect(() => decryptSecret(k, derived)).toThrow(/VERPLOY_ENCRYPTION_KEY/)
  })
})
