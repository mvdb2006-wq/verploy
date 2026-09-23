import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkSsl, classifyTlsError } from './ssl'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-ssl-'))
let server: https.Server
let port = 0
let cert = ''

beforeAll(async () => {
  // Echt certificaat (zelf-ondertekend, 10 dagen geldig) voor een echte TLS-handshake.
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '10', '-subj', '/CN=localhost/O=Verploy Test CA',
    '-addext', 'subjectAltName=DNS:localhost', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' })
  cert = fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8')
  server = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert }, (_, res) => res.end('ok'))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  port = (server.address() as { port: number }).port
})
afterAll(() => new Promise<void>(r => server.close(() => r())))

describe('SSL-controle (echte TLS-handshake)', () => {
  it('leest verloopdatum en uitgever; zelf-ondertekend is ongeldig', async () => {
    const r = await checkSsl(`https://localhost:${port}`)
    expect(r.error).toBe('self_signed')
    expect(r.valid).toBe(false)
    expect(r.issuer).toBe('Verploy Test CA')
    const days = (new Date(r.expiresAt!).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(9)
    expect(days).toBeLessThan(11)
  })

  it('hetzelfde certificaat, vertrouwd gemaakt → geldig', async () => {
    const r = await checkSsl(`https://localhost:${port}`, { ca: cert })
    expect(r).toMatchObject({ valid: true, error: null })
  })

  it('vertrouwd maar verkeerde hostnaam → hostname_mismatch', async () => {
    const r = await checkSsl(`https://127.0.0.1:${port}`, { ca: cert })
    expect(r.error).toBe('hostname_mismatch')
  })

  it('niets op de poort → unreachable (geen oordeel over SSL)', async () => {
    const r = await checkSsl('https://127.0.0.1:1', { timeoutMs: 2000 })
    expect(r).toEqual({ valid: null, expiresAt: null, issuer: null, error: 'unreachable' })
  })

  it('foutcodes', () => {
    expect(classifyTlsError('CERT_HAS_EXPIRED')).toBe('expired')
    expect(classifyTlsError('UNABLE_TO_VERIFY_LEAF_SIGNATURE')).toBe('untrusted')
  })
})
