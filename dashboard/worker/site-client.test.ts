import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { sign } from '@/lib/security/signing'
import { SiteClient, SiteRejectedError, TransientSiteError } from './site-client'

const SITE = '5ee00000-0000-4000-8000-00000000abcd'
const SECRET = 'c'.repeat(64)
const RUN = '1b2c3d4e-0000-4000-8000-000000000001'

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.url = url
    seen.init = init
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
}

describe('SiteClient', () => {
  it('ondertekent de REST-route (niet de URL) en stuurt run_id mee', async () => {
    const seen: { url?: string; init?: RequestInit } = {}
    const c = new SiteClient(SITE, SECRET, RUN, { fetch: fakeFetch(200, { locked: true }, seen) })
    await c.lock('https://klant.example/', 600)
    expect(seen.url).toBe('https://klant.example/?rest_route=/verploy/v2/run/lock')
    const h = seen.init!.headers as Record<string, string>
    const body = seen.init!.body as string
    expect(JSON.parse(body)).toEqual({ run_id: RUN, ttl: 600 })
    expect(h['x-verploy-site']).toBe(SITE)
    expect(h['x-verploy-signature']).toBe(sign(SECRET, 'POST', '/verploy/v2/run/lock', h['x-verploy-timestamp']!, h['x-verploy-nonce']!, body))
    expect(seen.init!.redirect).toBe('manual')
  })

  it('tokens gebruiken dezelfde formule als de plugin', () => {
    const c = new SiteClient(SITE, SECRET, RUN)
    expect(c.stagingToken()).toBe(createHmac('sha256', SECRET).update(`staging|${RUN}`).digest('hex'))
    expect(c.bypassToken()).toBe(createHmac('sha256', SECRET).update(`bypass|${RUN}`).digest('hex'))
  })

  it('5xx, 429 en onleesbare antwoorden zijn tijdelijk; 4xx niet', async () => {
    await expect(new SiteClient(SITE, SECRET, RUN, { fetch: fakeFetch(500, { code: 'verploy_run_failed', message: 'boom' }) }).cleanup('https://k.example'))
      .rejects.toBeInstanceOf(TransientSiteError)
    await expect(new SiteClient(SITE, SECRET, RUN, { fetch: fakeFetch(429, 'slow down') }).cleanup('https://k.example'))
      .rejects.toBeInstanceOf(TransientSiteError)
    await expect(new SiteClient(SITE, SECRET, RUN, { fetch: fakeFetch(200, '<html>cache</html>') }).cleanup('https://k.example'))
      .rejects.toBeInstanceOf(TransientSiteError)
    const rejected = await new SiteClient(SITE, SECRET, RUN, { fetch: fakeFetch(409, { code: 'verploy_locked', message: 'x' }) }).lock('https://k.example').catch(e => e)
    expect(rejected).toBeInstanceOf(SiteRejectedError)
    expect(rejected.code).toBe('verploy_locked')
  })

  it('netwerkfout is tijdelijk', async () => {
    const failing = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    await expect(new SiteClient(SITE, SECRET, RUN, { fetch: failing }).cleanup('https://k.example')).rejects.toBeInstanceOf(TransientSiteError)
  })
})
