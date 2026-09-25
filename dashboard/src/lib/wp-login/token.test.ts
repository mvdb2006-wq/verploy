import { describe, expect, it } from 'vitest'
import { autoPostPage, buildLoginToken, loginClaims, loginUrl } from './token'

describe('inlogtoken WP Admin', () => {
  it('testvector (gelijk aan connector-plugin/tests/run-tests.php)', () => {
    const token = buildLoginToken({ site: '5ee00000-0000-4000-8000-000000000001', aud: 'https://klant.example', user: 1, by: 'eigenaar@example.com',
      nonce: '0123456789abcdef0123456789abcdef', iat: 1700000000, exp: 1700000060 }, 'a'.repeat(64))
    expect(token).toBe(TOKEN_VECTOR)
  })
  it('60 seconden geldig', () => {
    const c = loginClaims({ site: 's', aud: 'https://x.example', user: 2, by: 'x@example.com', nonce: 'n', now: 1_700_000_000_500 })
    expect([c.iat, c.exp]).toEqual([1700000000, 1700000060])
  })
  it('POST-pagina: token alleen in het formulier, alles ge-escaped', () => {
    const html = autoPostPage({ action: loginUrl('https://klant.nl/'), token: 'abc.def', title: 'Inloggen…', button: 'Doorgaan' })
    expect(html).toContain('action="https://klant.nl/wp-login.php?action=verploy_sso"')
    expect(html).toContain('name="token" value="abc.def"')
    expect(html).toContain('content="no-referrer"')
    expect(autoPostPage({ action: 'x', token: '"><script>', title: 't', button: 'b' })).not.toContain('"><script>')
  })
})

// Onafhankelijk berekend met base64 + openssl dgst -sha256 -hmac.
const TOKEN_VECTOR = 'eyJ2IjoxLCJzaXRlIjoiNWVlMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwiYXVkIjoiaHR0cHM6Ly9rbGFudC5leGFtcGxlIiwidXNlciI6MSwiYnkiOiJlaWdlbmFhckBleGFtcGxlLmNvbSIsIm5vbmNlIjoiMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMDA2MH0'
  + '.5364afe76e61a542739e14304552364d0c2e8b066644c8f93a7c7b6f4c16508e'
