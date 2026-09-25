import { describe, expect, it } from 'vitest'
import { buildSiteRows, matchesQuery } from './list'

const NOW = Date.parse('2026-09-24T12:00:00Z')
const site = (id: string, over: Partial<{ name: string; url: string; client_name: string | null; effective: string; paired_at: string | null }> = {}) =>
  ({ id, name: id, url: `https://${id}.nl`, client_name: null, effective: 'online', paired_at: '2026-01-01T00:00:00Z', ...over })
const empty = { updates: [], alerts: [], vulns: [], activeRunSites: new Set<string>(), lastRuns: [], offline: [] }

describe('buildSiteRows', () => {
  it('connector verouderd: alleen gekoppelde sites met een oudere versie, met beide versies', () => {
    const c = (id: string, v: string | null, status = 'connected') => ({ ...site(id), connector_version: v, connection_status: status })
    const rows = buildSiteRows([c('oud', '2.4.0'), c('nieuw', '2.5.0'), c('kort', '2.5'), c('los', '2.3.0', 'awaiting_pairing'), c('geen', null)], empty, NOW, { latestConnector: '2.5.0' })
    const by = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(by.oud!.connector).toEqual({ installed: '2.4.0', latest: '2.5.0' })
    expect(by.oud!.filters).toContain('connector')
    for (const id of ['nieuw', 'kort', 'los', 'geen']) {
      expect(by[id]!.connector).toBeNull()
      expect(by[id]!.filters).not.toContain('connector')
    }
  })

  it('deelt sites in: gezond, aandacht, offline, wordt bijgewerkt, kwetsbaar', () => {
    const rows = buildSiteRows([
      site('a'), site('b'), site('c', { effective: 'offline' }), site('d', { effective: 'pending', paired_at: null }), site('e'),
    ], {
      ...empty,
      alerts: [{ site_id: 'b', severity: 'warning' }, { site_id: 'b', severity: 'critical' }, { site_id: 'a', severity: 'info' }],
      vulns: [{ site_id: 'e', severity: 'medium' }, { site_id: 'e', severity: 'high' }],
      activeRunSites: new Set(['a']),
    }, NOW)
    const by = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(by.a!.filters).toEqual(['all', 'healthy', 'updating'])      // info-melding telt niet
    expect(by.b!.filters).toEqual(['all', 'attention'])
    expect(by.b!.alert).toEqual({ severity: 'critical', count: 2 })
    expect(by.c!.filters).toEqual(['all', 'offline'])
    expect(by.d!.filters).toEqual(['all', 'attention'])                // nog niet gekoppeld
    expect(by.d!.uptime).toBeNull()
    expect(by.e!).toMatchObject({ vulns: 2, vulnSeverity: 'high', filters: ['all', 'healthy', 'vulnerable'] })
  })

  it('uptime over 30 dagen uit offline-meldingen; laatste afgeronde update', () => {
    const [r] = buildSiteRows([site('a')], {
      ...empty,
      offline: [{ site_id: 'a', opened_at: '2026-09-20T10:45:00Z', resolved_at: '2026-09-20T12:00:00Z', since: '2026-09-20T10:00:00Z' }],
      lastRuns: [
        { id: 'r1', site_id: 'a', verdict: 'deployed', reason_key: null, finished_at: '2026-09-20T09:00:00Z' },
        { id: 'r2', site_id: 'a', verdict: 'blocked', reason_key: null, finished_at: '2026-09-22T09:00:00Z' },
      ],
    }, NOW)
    expect(r!.uptime).toBeCloseTo(100 * (1 - 120 / (30 * 24 * 60 - 12 * 60)), 2)   // 2 uur plat; periode tot nu
    expect(r!.lastRun).toMatchObject({ id: 'r2', verdict: 'blocked' })
  })
})

describe('matchesQuery', () => {
  const row = { name: 'Borgo Vista Serena', domain: 'borgovistaserena.com', client: 'Familie Rossi' }
  it('op naam, domein en klant; alle woorden moeten passen; hoofdletterongevoelig', () => {
    expect(matchesQuery(row, '')).toBe(true)
    expect(matchesQuery(row, 'vista')).toBe(true)
    expect(matchesQuery(row, 'BorgoVistaSerena.COM')).toBe(true)
    expect(matchesQuery(row, 'rossi')).toBe(true)
    expect(matchesQuery(row, 'borgo rossi')).toBe(true)
    expect(matchesQuery(row, 'borgo zeeland')).toBe(false)
  })
})
