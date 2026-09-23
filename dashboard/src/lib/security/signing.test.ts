import { describe, expect, it } from 'vitest'
import { canonicalString, readSignedHeaders, sign, signedHeaders, verify, SIGNATURE_WINDOW_SECONDS } from './signing'

const SECRET = 'a'.repeat(64)
const SITE = '5ee00000-0000-4000-8000-000000000001'

function headersToGetter(h: Record<string, string>) {
  return (name: string) => h[name.toLowerCase()] ?? null
}

describe('signing', () => {
  it('canonieke string heeft vaste volgorde en body-hash', () => {
    expect(canonicalString('post', '/api/v2/heartbeat', '1700000000', 'ab'.repeat(16), '{}')).toBe(
      ['POST', '/api/v2/heartbeat', '1700000000', 'ab'.repeat(16),
        '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'].join('\n'),
    )
  })

  it('bekende testvector, onafhankelijk berekend met openssl (zelfde vector in de PHP-plugin-test)', () => {
    // printf 'POST\n/api/v2/heartbeat\n1700000000\n<nonce>\n<sha256({"a":1})>' | openssl dgst -sha256 -hmac test-secret
    expect(sign('test-secret', 'POST', '/api/v2/heartbeat', '1700000000', '0123456789abcdef0123456789abcdef', '{"a":1}'))
      .toBe('dfe01908feea374cb22544b3cb9ce0e190d88ebceca5d75d7a3e738842a101e8')
  })

  it('geldige handtekening wordt geaccepteerd', () => {
    const body = JSON.stringify({ hello: 'world' })
    const h = readSignedHeaders(headersToGetter(signedHeaders(SITE, SECRET, 'POST', '/api/v2/heartbeat', body)))!
    expect(verify([SECRET], h, 'POST', '/api/v2/heartbeat', body)).toEqual({ ok: true })
  })

  it('gemanipuleerde body, pad of methode wordt geweigerd', () => {
    const body = '{"a":1}'
    const h = readSignedHeaders(headersToGetter(signedHeaders(SITE, SECRET, 'POST', '/p', body)))!
    expect(verify([SECRET], h, 'POST', '/p', '{"a":2}')).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verify([SECRET], h, 'POST', '/q', body)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verify([SECRET], h, 'GET', '/p', body)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('verkeerd secret wordt geweigerd; vorig secret (rotatie) wordt geaccepteerd', () => {
    const h = readSignedHeaders(headersToGetter(signedHeaders(SITE, SECRET, 'POST', '/p', '')))!
    expect(verify(['b'.repeat(64)], h, 'POST', '/p', '')).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verify(['b'.repeat(64), SECRET], h, 'POST', '/p', '')).toEqual({ ok: true })
  })

  it('te oude of te nieuwe timestamp wordt geweigerd (replay-venster)', () => {
    const now = Date.now()
    const old = readSignedHeaders(headersToGetter(signedHeaders(SITE, SECRET, 'POST', '/p', '', now - (SIGNATURE_WINDOW_SECONDS + 5) * 1000)))!
    const future = readSignedHeaders(headersToGetter(signedHeaders(SITE, SECRET, 'POST', '/p', '', now + (SIGNATURE_WINDOW_SECONDS + 5) * 1000)))!
    expect(verify([SECRET], old, 'POST', '/p', '', now)).toEqual({ ok: false, reason: 'stale' })
    expect(verify([SECRET], future, 'POST', '/p', '', now)).toEqual({ ok: false, reason: 'stale' })
  })

  it('misvormde headers worden niet geparsed', () => {
    const good = signedHeaders(SITE, SECRET, 'POST', '/p', '')
    expect(readSignedHeaders(headersToGetter({ ...good, 'x-verploy-signature': 'zz' }))).toBeNull()
    expect(readSignedHeaders(headersToGetter({ ...good, 'x-verploy-nonce': 'kort' }))).toBeNull()
    expect(readSignedHeaders(headersToGetter({ ...good, 'x-verploy-site': 'nope' }))).toBeNull()
    const missing: Record<string, string> = { ...good }
    delete missing['x-verploy-timestamp']
    expect(readSignedHeaders(headersToGetter(missing))).toBeNull()
  })
})
