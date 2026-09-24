import { describe, expect, it } from 'vitest'
import { encryptSecret } from '@/lib/security/secretbox'
import { usableSecrets } from './auth'

const OLD = { primary: Buffer.alloc(32, 1).toString('base64'), serviceRoleKey: 'x'.repeat(40) }
const NEW = { primary: Buffer.alloc(32, 2).toString('base64'), serviceRoleKey: 'x'.repeat(40) }
const future = new Date(Date.now() + 3600_000).toISOString()
const past = new Date(Date.now() - 1000).toISOString()

describe('usableSecrets', () => {
  it('huidig en (binnen de overgangsperiode) vorig secret', () => {
    const cred = { secret_ciphertext: encryptSecret('nieuw', NEW), previous_secret_ciphertext: encryptSecret('oud', NEW), previous_valid_until: future }
    expect(usableSecrets(cred, NEW)).toEqual(['nieuw', 'oud'])
    expect(usableSecrets({ ...cred, previous_valid_until: past }, NEW)).toEqual(['nieuw'])
  })

  it('vorig secret met een vervangen sleutel blokkeert het nieuwe niet (gezien op productie: HTTP 500 na opnieuw koppelen)', () => {
    const cred = { secret_ciphertext: encryptSecret('nieuw', NEW), previous_secret_ciphertext: encryptSecret('oud', OLD), previous_valid_until: future }
    expect(usableSecrets(cred, NEW)).toEqual(['nieuw'])
  })

  it('niets te ontsleutelen → leeg (de route antwoordt dan "onbekende site": opnieuw koppelen)', () => {
    const cred = { secret_ciphertext: encryptSecret('oud', OLD), previous_secret_ciphertext: null, previous_valid_until: null }
    expect(usableSecrets(cred, NEW)).toEqual([])
  })
})
