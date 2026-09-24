import { describe, expect, it } from 'vitest'
import { compareVersions, inRange } from './version'
import { feedSlug, fixedVersion, matchComponents, normalizeFeedRecord, severityOf, type SiteComponent, type VulnerabilityRecord } from './match'

describe('compareVersions (zoals PHP version_compare)', () => {
  it.each([
    ['1.0.0', '1.0.0', 0], ['1.2.3', '1.2.4', -1], ['1.10', '1.9', 1], ['2.0', '1.99.99', 1],
    ['1.0', '1.0.0', -1], ['1.0.1', '1.0', 1],
    ['1.0-beta', '1.0', -1], ['1.0-RC1', '1.0-beta2', 1], ['1.0-alpha', '1.0-dev', 1], ['1.0pl1', '1.0', 1],
    ['6.8.1', '6.8', 1], ['5.4', '5.4', 0],
  ] as const)('%s vs %s → %s', (a, b, o) => {
    expect(compareVersions(a, b)).toBe(o)
    expect(compareVersions(b, a)).toBe(-o || 0)
  })
})

describe('inRange', () => {
  const r = (from: string, fi: boolean, to: string, ti: boolean) => ({ from, fromInclusive: fi, to, toInclusive: ti })
  it('inclusief en exclusief', () => {
    expect(inRange('1.2.3', r('1.0.0', true, '1.2.3', true))).toBe(true)
    expect(inRange('1.2.3', r('1.0.0', true, '1.2.3', false))).toBe(false)
    expect(inRange('1.0.0', r('1.0.0', false, '2', true))).toBe(false)
  })
  it('* is onbegrensd', () => {
    expect(inRange('0.1', r('*', true, '1.5', true))).toBe(true)
    expect(inRange('1.6', r('*', true, '1.5', true))).toBe(false)
    expect(inRange('99', r('2.0', true, '*', true))).toBe(true)
  })
})

describe('feedSlug', () => {
  it.each([
    [{ type: 'plugin', slug: 'akismet/akismet.php' }, 'akismet'],
    [{ type: 'plugin', slug: 'Contact-Form-7/wp-contact-form-7.php' }, 'contact-form-7'],
    [{ type: 'plugin', slug: 'hello.php' }, 'hello-dolly'],
    [{ type: 'plugin', slug: 'my-single.php' }, 'my-single'],
    [{ type: 'theme', slug: 'twentytwentyfive' }, 'twentytwentyfive'],
    [{ type: 'core', slug: 'wordpress' }, 'wordpress'],
  ] as const)('%j → %s', (c, o) => { expect(feedSlug(c)).toBe(o) })
})

describe('severityOf', () => {
  it.each([['Critical', 9.8, 'critical'], ['High', 7.5, 'high'], [null, 9.1, 'critical'], [null, 5, 'medium'], [null, 2, 'low'], [null, null, 'medium']] as const)(
    '%s / %s → %s', (r, s, o) => { expect(severityOf(r, s)).toBe(o) })
})

const vuln = (over: Partial<VulnerabilityRecord> = {}): VulnerabilityRecord => ({
  id: 'v1', software_type: 'plugin', slug: 'akismet', name: 'Akismet', title: 'XSS in Akismet',
  affected: [{ from: '*', fromInclusive: true, to: '5.3', toInclusive: true }], patched_versions: ['5.3.1'],
  severity: 'high', cvss_score: 7.2, cve: null, reference_url: null, published_at: null, source_updated_at: null, mitre: false, ...over,
})
const comp = (over: Partial<SiteComponent> = {}): SiteComponent => ({
  type: 'plugin', slug: 'akismet/akismet.php', name: 'Akismet', version: '5.3', latest_version: '5.4', update_available: true, ...over,
})
const index = (...recs: VulnerabilityRecord[]) => {
  const m = new Map<string, VulnerabilityRecord[]>()
  for (const r of recs) m.set(`${r.software_type}:${r.slug}`, [...(m.get(`${r.software_type}:${r.slug}`) ?? []), r])
  return m
}

describe('fixedVersion', () => {
  it('laagste gepatchte versie boven de geïnstalleerde die zelf niet kwetsbaar is', () => {
    const rec = { affected: [{ from: '*', fromInclusive: true, to: '2.0', toInclusive: false }], patched_versions: ['1.9.9', '2.1', '2.0'] }
    expect(fixedVersion('1.5', rec)).toBe('2.0')
    expect(fixedVersion('2.5', { ...rec, patched_versions: [] })).toBeNull()
  })
})

describe('matchComponents', () => {
  it('geraakt + oplosbaar via de klaarstaande update', () => {
    const [f] = matchComponents([comp()], index(vuln()))
    expect(f).toMatchObject({ vulnerability_id: 'v1', installed_version: '5.3', fixed_version: '5.3.1', severity: 'high', fixable: true })
  })
  it('niet geraakt als de geïnstalleerde versie buiten het bereik valt', () => {
    expect(matchComponents([comp({ version: '5.3.1' })], index(vuln()))).toEqual([])
  })
  it('niet oplosbaar als de klaarstaande update nog kwetsbaar is of er geen update is', () => {
    expect(matchComponents([comp({ latest_version: '5.2.9' })], index(vuln({ affected: [{ from: '*', fromInclusive: true, to: '6', toInclusive: true }], patched_versions: [] })))[0]?.fixable).toBe(false)
    expect(matchComponents([comp({ update_available: false, latest_version: null })], index(vuln()))[0]?.fixable).toBe(false)
  })
  it('onderdelen zonder versie en andere types worden overgeslagen', () => {
    expect(matchComponents([comp({ version: null })], index(vuln()))).toEqual([])
    expect(matchComponents([comp({ type: 'theme', slug: 'akismet' })], index(vuln()))).toEqual([])
  })
  it('core wordt op "wordpress" gematcht', () => {
    const core = comp({ type: 'core', slug: 'wordpress', name: 'WordPress', version: '6.8', latest_version: '6.8.1' })
    const rec = vuln({ software_type: 'core', slug: 'wordpress', affected: [{ from: '6.8', fromInclusive: true, to: '6.8', toInclusive: true }], patched_versions: ['6.8.1'], severity: 'critical' })
    expect(matchComponents([core], index(rec))).toMatchObject([{ type: 'core', fixed_version: '6.8.1', fixable: true, severity: 'critical' }])
  })
  it('sorteert op ernst (kritiek eerst)', () => {
    const fs = matchComponents([comp(), comp({ slug: 'b/b.php', name: 'B' })], index(vuln({ severity: 'low' }), vuln({ id: 'v2', slug: 'b', severity: 'critical' })))
    expect(fs.map(f => f.severity)).toEqual(['critical', 'low'])
  })
})

describe('normalizeFeedRecord (Wordfence v3)', () => {
  const record = {
    id: '848ccbdc-c6f1-480f-a272-cd459e706713', title: 'Example Vulnerability',
    software: [{ type: 'plugin', name: 'Example Plugin', slug: 'example',
      affected_versions: { '1.0.0 - 1.2.3': { from_version: '1.0.0', from_inclusive: true, to_version: '1.2.3', to_inclusive: true } },
      patched: true, patched_versions: ['1.2.4'] }],
    informational: false, references: ['https://www.wordfence.com/threat-intel/vulnerabilities/example'],
    cvss: { vector: 'CVSS:3.1/AV:N', score: 6.5, rating: 'Medium' }, cve: 'CVE-1998-1000',
    published: '1998-01-09 00:00:00', updated: '2022-08-05 20:14:05',
    copyrights: { message: 'x', defiant: { notice: 'Copyright Defiant' }, mitre: { notice: 'Copyright MITRE' } },
  }
  it('zet een record om naar rijen', () => {
    expect(normalizeFeedRecord(record)).toEqual([{
      id: record.id, software_type: 'plugin', slug: 'example', name: 'Example Plugin', title: 'Example Vulnerability',
      affected: [{ from: '1.0.0', fromInclusive: true, to: '1.2.3', toInclusive: true }], patched_versions: ['1.2.4'],
      severity: 'medium', cvss_score: 6.5, cve: 'CVE-1998-1000',
      reference_url: 'https://www.wordfence.com/threat-intel/vulnerabilities/example',
      published_at: '1998-01-09T00:00:00Z', source_updated_at: '2022-08-05T20:14:05Z', mitre: true,
    }])
  })
  it('dezelfde software twee keer in één record → één rij met alle versiereeksen', () => {
    const sw = record.software[0]!
    const rows = normalizeFeedRecord({ ...record, software: [sw, { ...sw, affected_versions: { '2.0 - 2.1': { from_version: '2.0', from_inclusive: true, to_version: '2.1', to_inclusive: true } }, patched_versions: ['2.2'] }] })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.affected).toHaveLength(2)
    expect(rows[0]!.patched_versions).toEqual(['1.2.4', '2.2'])
  })
  it('informatief of onleesbaar → overgeslagen', () => {
    expect(normalizeFeedRecord({ ...record, informational: true })).toEqual([])
    expect(normalizeFeedRecord({ ...record, software: [{ type: 'plugin', slug: 'x', affected_versions: {} }] })).toEqual([])
    expect(normalizeFeedRecord({ ...record, software: [{ type: 'library', slug: 'x', affected_versions: record.software[0]!.affected_versions }] })).toEqual([])
    expect(normalizeFeedRecord({ title: 'geen id' })).toEqual([])
  })
})
