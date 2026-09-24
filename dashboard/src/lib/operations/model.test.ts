import { describe, expect, it } from 'vitest'
import { createTranslator } from '@/lib/i18n/core'
import { formatDuration, groupFindings, inboxItems, median, portfolioHealth, runProgress, siteState, type AlertLite, type FindingRow, type RunLite } from './model'

const f = (over: Partial<FindingRow> = {}): FindingRow => ({
  site_id: 's1', vulnerability_id: 'v1', component_type: 'plugin', component_slug: 'yoast/yoast.php', component_name: 'Yoast SEO',
  installed_version: '25.0', fixed_version: '25.1', fixable: true, severity: 'high', first_seen_at: '2026-09-24T10:00:00Z', autofix_run_id: null, ...over,
})
const base = { autofix: false, activeRunSites: new Set<string>(), runsById: new Map<string, RunLite>() }

describe('siteState', () => {
  it('ernstig + oplosbaar: wacht op akkoord, of Verploy lost op als automatisch aan staat', () => {
    expect(siteState(f(), base)).toBe('awaiting')
    expect(siteState(f(), { ...base, autofix: true })).toBe('scheduled')
  })
  it('lopende run gaat voor; geen oplossing; laag/middel alleen "beschikbaar"', () => {
    expect(siteState(f(), { ...base, activeRunSites: new Set(['s1']) })).toBe('fixing')
    expect(siteState(f({ fixable: false }), base)).toBe('no_fix')
    expect(siteState(f({ severity: 'medium' }), base)).toBe('fixable')
  })
  it('automatische poging tegengehouden → nakijken', () => {
    const runsById = new Map([['r1', { id: 'r1', site_id: 's1', status: 'done', verdict: 'blocked' }]])
    expect(siteState(f({ autofix_run_id: 'r1' }), { ...base, autofix: true, runsById })).toBe('blocked')
    const ok = new Map([['r1', { id: 'r1', site_id: 's1', status: 'done', verdict: 'deployed' }]])
    expect(siteState(f({ autofix_run_id: 'r1' }), { ...base, autofix: true, runsById: ok })).toBe('scheduled')
  })
})

describe('groupFindings', () => {
  it('groepeert per kwetsbaarheid over sites, ernstigste en oudste eerst, telt statussen', () => {
    const groups = groupFindings([
      f({ site_id: 's2', first_seen_at: '2026-09-24T09:00:00Z' }), f(),
      f({ vulnerability_id: 'v2', severity: 'critical', component_name: 'Elementor', fixable: false }),
      f({ vulnerability_id: 'v3', severity: 'low' }),
    ], new Map([['v1', { id: 'v1', title: 'XSS', cve: 'CVE-1', cvss_score: 7.2, reference_url: null }]]), new Map([['s1', 'Alfa'], ['s2', 'Beta']]), base)
    expect(groups.map(g => g.id)).toEqual(['v2', 'v1', 'v3'])
    const v1 = groups[1]!
    expect(v1).toMatchObject({ title: 'XSS', cve: 'CVE-1', firstSeen: '2026-09-24T09:00:00Z', counts: { awaiting: 2 } })
    expect(v1.sites.map(s => s.siteName)).toEqual(['Alfa', 'Beta'])
  })
  it('één lek in thema én plugin op dezelfde site telt als één site (en één knop-site)', () => {
    const groups = groupFindings([
      f({ vulnerability_id: 'v9', component_type: 'theme', component_slug: 'Avada', component_name: 'Avada' }),
      f({ vulnerability_id: 'v9', component_type: 'plugin', component_slug: 'fusion-builder/fusion-builder.php', component_name: 'Avada Builder' }),
      f({ vulnerability_id: 'v9', site_id: 's2' }),
    ], new Map(), new Map([['s1', 'Alfa'], ['s2', 'Beta']]), base)
    expect(groups[0]).toMatchObject({ siteCount: 2, counts: { awaiting: 2 } })
    expect(groups[0]!.sites).toHaveLength(3)   // detail per onderdeel blijft zichtbaar
    expect(inboxItems(groups, [])[0]).toMatchObject({ kind: 'approve', siteIds: ['s1', 's2'] })
  })
})

describe('inboxItems', () => {
  const alert = (over: Partial<AlertLite> = {}): AlertLite => ({ id: 'a1', type: 'site_offline', severity: 'critical', params: {}, opened_at: '2026-09-24T08:00:00Z', site_id: 's1', siteName: 'Alfa', acknowledged_at: null, ...over })
  it('beslissingen voor ernstige lekken, problemen voor meldingen; lage lekken en bevestigde/lek-meldingen niet', () => {
    const groups = groupFindings([
      f(), f({ vulnerability_id: 'v2', fixable: false, severity: 'critical' }), f({ vulnerability_id: 'v3', severity: 'medium' }),
    ], new Map(), new Map([['s1', 'Alfa']]), base)
    const items = inboxItems(groups, [alert(), alert({ id: 'a2', acknowledged_at: '2026-09-24T09:00:00Z' }), alert({ id: 'a3', type: 'vulnerability' }), alert({ id: 'a4', severity: 'info' })])
    expect(items.map(i => i.key)).toEqual(['alert:a1', 'nofix:v2', 'approve:v1'])
    expect(items.find(i => i.kind === 'approve')).toMatchObject({ siteIds: ['s1'] })
  })
  it('met automatisch oplossen aan: geen goedkeuring nodig', () => {
    const groups = groupFindings([f()], new Map(), new Map(), { ...base, autofix: true })
    expect(inboxItems(groups, [])).toEqual([])
  })
})

describe('hulpjes', () => {
  const nl = createTranslator('nl')
  it('formatDuration: twee grootste eenheden', () => {
    expect(formatDuration(8 * 60_000, nl)).toBe('8 min')
    expect(formatDuration((3 * 60 + 12) * 60_000, nl)).toBe('3 u 12 min')
    expect(formatDuration((2 * 1440 + 3 * 60 + 5) * 60_000, nl)).toBe('2 d 3 u')
    expect(formatDuration(-5, nl)).toBe('0 min')
  })
  it('median', () => {
    expect(median([])).toBeNull()
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(3)
  })
  it('runProgress loopt op per stap', () => {
    expect(runProgress('queued')).toBe(0)
    expect(runProgress('preparing')).toBeGreaterThan(0)
    expect(runProgress('postcheck')).toBeGreaterThan(runProgress('staging_test'))
    expect(runProgress('done')).toBe(1)
  })
  it('portfolioHealth: gezond = online en zonder open melding', () => {
    expect(portfolioHealth([{ id: 'a', effective: 'online' }, { id: 'b', effective: 'online' }, { id: 'c', effective: 'offline' }, { id: 'd', effective: 'pending' }], new Set(['b'])))
      .toEqual({ total: 4, healthy: 1, attention: 1, offline: 1, pending: 1 })
  })
})
