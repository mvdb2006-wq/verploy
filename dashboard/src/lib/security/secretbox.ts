import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM voor site-secrets in rust.
 * Formaat: `<keyId>:<iv b64url>:<ciphertext b64url>:<tag b64url>`
 *   keyId `k1` = VERPLOY_ENCRYPTION_KEY, `d1` = afgeleid van de service-role-key.
 * Door het keyId kan later een eigen sleutel worden ingevoerd zonder oude data te breken.
 */
export interface KeyMaterial { primary?: string; serviceRoleKey: string }

type KeyId = 'k1' | 'd1'

function keyFor(id: KeyId, km: KeyMaterial): Buffer {
  if (id === 'k1') {
    if (!km.primary) throw new Error('secretbox: VERPLOY_ENCRYPTION_KEY ontbreekt voor k1-ciphertext')
    const k = Buffer.from(km.primary, 'base64')
    if (k.length !== 32) throw new Error('secretbox: VERPLOY_ENCRYPTION_KEY moet 32 bytes (base64) zijn')
    return k
  }
  return Buffer.from(hkdfSync('sha256', km.serviceRoleKey, 'verploy/site-secrets', 'aes-256-gcm/v1', 32))
}

export function encryptSecret(plaintext: string, km: KeyMaterial): string {
  const id: KeyId = km.primary ? 'k1' : 'd1'
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFor(id, km), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [id, iv.toString('base64url'), ct.toString('base64url'), cipher.getAuthTag().toString('base64url')].join(':')
}

export function decryptSecret(box: string, km: KeyMaterial): string {
  const [id, iv, ct, tag] = box.split(':')
  if ((id !== 'k1' && id !== 'd1') || !iv || !ct || !tag) throw new Error('secretbox: ongeldig formaat')
  const decipher = createDecipheriv('aes-256-gcm', keyFor(id, km), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
}
