import { beforeEach, describe, expect, it } from 'vitest'
import { lookupDomainExpiry, parseExpiration, rdapBaseFor, registrableCandidates, resetBootstrapCache } from './rdap'

// Structuur volgens RFC 9224 (bootstrap) en RFC 9083 (domeinobject).
const bootstrap = { services: [[['com', 'net'], ['https://rdap.verisign.test/com/v1/']], [['nl'], ['https://rdap.sidn.test/']], [['uk'], ['https://rdap.nominet.test/uk/']]] }

function fakeFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: string[] = []
  const impl = async (url: string) => {
    calls.push(url)
    const r = routes[url] ?? { status: 404 }
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status })
  }
  return { impl, calls }
}

beforeEach(() => resetBootstrapCache())

describe('RDAP', () => {
  it('kandidaten: www eraf, 2 dan 3 labels, IP-adressen niet', () => {
    expect(registrableCandidates('www.klant.nl')).toEqual(['klant.nl'])
    expect(registrableCandidates('shop.klant.co.uk')).toEqual(['co.uk', 'klant.co.uk'])
    expect(registrableCandidates('127.0.0.1')).toEqual([])
  })

  it('kiest de https-server uit de bootstrap', () => {
    expect(rdapBaseFor('COM', bootstrap.services as never)).toBe('https://rdap.verisign.test/com/v1/')
    expect(rdapBaseFor('xyz', bootstrap.services as never)).toBeNull()
  })

  it('leest de expiration-gebeurtenis', () => {
    expect(parseExpiration({ events: [{ eventAction: 'registration', eventDate: '2010-01-01T00:00:00Z' }, { eventAction: 'expiration', eventDate: '2027-03-01T00:00:00Z' }] }))
      .toBe('2027-03-01T00:00:00.000Z')
    expect(parseExpiration({ events: [{ eventAction: 'registration', eventDate: '2010-01-01T00:00:00Z' }] })).toBeNull()
  })

  it('.com met verloopdatum', async () => {
    const f = fakeFetch({
      'https://data.iana.org/rdap/dns.json': { status: 200, body: bootstrap },
      'https://rdap.verisign.test/com/v1/domain/voorbeeld.com': { status: 200, body: { events: [{ eventAction: 'expiration', eventDate: '2026-10-10T12:00:00Z' }] } },
    })
    expect(await lookupDomainExpiry('https://www.voorbeeld.com', f.impl)).toEqual({ expiresAt: '2026-10-10T12:00:00.000Z', error: null })
  })

  it('.nl zonder gepubliceerde verloopdatum → not_published', async () => {
    const f = fakeFetch({
      'https://data.iana.org/rdap/dns.json': { status: 200, body: bootstrap },
      'https://rdap.sidn.test/domain/klant.nl': { status: 200, body: { events: [{ eventAction: 'registration', eventDate: '2015-05-05T00:00:00Z' }] } },
    })
    expect(await lookupDomainExpiry('https://klant.nl', f.impl)).toEqual({ expiresAt: null, error: 'not_published' })
  })

  it('co.uk: 404 op 2 labels, daarna 3 labels', async () => {
    const f = fakeFetch({
      'https://data.iana.org/rdap/dns.json': { status: 200, body: bootstrap },
      'https://rdap.nominet.test/uk/domain/klant.co.uk': { status: 200, body: { events: [{ eventAction: 'expiration', eventDate: '2027-01-01T00:00:00Z' }] } },
    })
    expect(await lookupDomainExpiry('https://shop.klant.co.uk', f.impl)).toMatchObject({ error: null })
    expect(f.calls).toContain('https://rdap.nominet.test/uk/domain/co.uk')
  })

  it('netwerkfout of onbekende TLD → lookup_failed, geen crash', async () => {
    const down = async () => { throw new Error('ECONNRESET') }
    expect(await lookupDomainExpiry('https://klant.nl', down)).toEqual({ expiresAt: null, error: 'lookup_failed' })
    const f = fakeFetch({ 'https://data.iana.org/rdap/dns.json': { status: 200, body: bootstrap } })
    expect(await lookupDomainExpiry('https://klant.xyz', f.impl)).toEqual({ expiresAt: null, error: 'lookup_failed' })
  })
})
