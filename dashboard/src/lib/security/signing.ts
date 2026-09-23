import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Verploy request-ondertekening (identiek geïmplementeerd in de WordPress-plugin
 * en de worker). Zie PLAN.md §4.
 *
 *   canonical = METHOD \n PATH \n TIMESTAMP \n NONCE \n sha256_hex(body)
 *   signature = hex(HMAC-SHA256(secret, canonical))
 */
export const SIGNATURE_WINDOW_SECONDS = 300

export const HEADER = {
  site: 'x-verploy-site',
  timestamp: 'x-verploy-timestamp',
  nonce: 'x-verploy-nonce',
  signature: 'x-verploy-signature',
} as const

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function canonicalString(method: string, path: string, timestamp: string, nonce: string, body: string): string {
  return [method.toUpperCase(), path, timestamp, nonce, sha256Hex(body)].join('\n')
}

export function sign(secret: string, method: string, path: string, timestamp: string, nonce: string, body: string): string {
  return createHmac('sha256', secret).update(canonicalString(method, path, timestamp, nonce, body)).digest('hex')
}

export function newNonce(): string {
  return randomBytes(16).toString('hex')
}

export interface SignedHeaders {
  siteId: string
  timestamp: string
  nonce: string
  signature: string
}

export function signedHeaders(siteId: string, secret: string, method: string, path: string, body: string, now = Date.now()): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000))
  const nonce = newNonce()
  return {
    [HEADER.site]: siteId,
    [HEADER.timestamp]: timestamp,
    [HEADER.nonce]: nonce,
    [HEADER.signature]: sign(secret, method, path, timestamp, nonce, body),
  }
}

export function readSignedHeaders(get: (name: string) => string | null): SignedHeaders | null {
  const siteId = get(HEADER.site)
  const timestamp = get(HEADER.timestamp)
  const nonce = get(HEADER.nonce)
  const signature = get(HEADER.signature)
  if (!siteId || !timestamp || !nonce || !signature) return null
  if (!/^[0-9a-f-]{36}$/i.test(siteId) || !/^\d{9,12}$/.test(timestamp) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) {
    return null
  }
  return { siteId, timestamp, nonce, signature }
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'stale' | 'bad_signature' }

/** Controleert tijdvenster en handtekening (constante tijd). Nonce-uniciteit controleert de aanroeper. */
export function verify(
  secrets: string[],
  h: SignedHeaders,
  method: string,
  path: string,
  body: string,
  now = Date.now(),
): VerifyResult {
  const age = Math.abs(Math.floor(now / 1000) - Number(h.timestamp))
  if (!Number.isFinite(age) || age > SIGNATURE_WINDOW_SECONDS) return { ok: false, reason: 'stale' }
  const given = Buffer.from(h.signature, 'hex')
  for (const secret of secrets) {
    const expected = Buffer.from(sign(secret, method, path, h.timestamp, h.nonce, body), 'hex')
    if (expected.length === given.length && timingSafeEqual(expected, given)) return { ok: true }
  }
  return { ok: false, reason: 'bad_signature' }
}
