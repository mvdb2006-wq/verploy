import { describe, expect, it } from 'vitest'
import type { RunItem } from '@/lib/run-items'
import { CONNECTOR_SLUG, approvalReason, decide, inWindow, isDue, localHour, plan, validTimezone, type Component, type PastRun } from './policy'

const comp = (over: Partial<Component> = {}): Component => ({ type: 'plugin', slug: 'x/x.php', name: 'X', version: '1.2.0', latest_version: '1.3.0', ...over })
const item = (over: Partial<RunItem> = {}): RunItem => ({ type: 'plugin', slug: 'x/x.php', name: 'X', from_version: '1.2.0', to_version: '1.3.0', ...over })
const run = (items: RunItem[], verdict: string): PastRun => ({ status: 'done', verdict, items })

describe('moment', () => {
  // 25 sep 2026 00:30 UTC = 02:30 in Amsterdam (zomertijd)
  const night = new Date('2026-09-25T00:30:00Z')
  it('tijdzone van het bureau', () => {
    expect(localHour(night, 'Europe/Amsterdam')).toBe(2)
    expect(localHour(night, 'America/New_York')).toBe(20)
    expect(validTimezone('Europe/Amsterdam')).toBe(true)
    expect(validTimezone('Mars/Olympus')).toBe(false)
    expect(localHour(night, 'Mars/Olympus')).toBe(2)          // ongeldig → Amsterdam
  })
  it('vensters', () => {
    expect(inWindow(night, 'Europe/Amsterdam', 'night')).toBe(true)
    expect(inWindow(night, 'Europe/Amsterdam', 'evening')).toBe(false)
    expect(inWindow(night, 'America/New_York', 'evening')).toBe(true)
    expect(inWindow(new Date('2026-09-25T03:00:00Z'), 'Europe/Amsterdam', 'night')).toBe(false)   // 05:00 is net voorbij
  })
  it('één keer per dag of per week', () => {
    const base = { now: night, timezone: 'Europe/Amsterdam', window: 'night' as const }
    expect(isDue({ ...base, frequency: 'daily', lastScheduledAt: null })).toBe(true)
    expect(isDue({ ...base, frequency: 'daily', lastScheduledAt: '2026-09-25T00:05:00Z' })).toBe(false)   // vannacht al
    expect(isDue({ ...base, frequency: 'daily', lastScheduledAt: '2026-09-24T00:10:00Z' })).toBe(true)    // gisternacht
    expect(isDue({ ...base, frequency: 'weekly', lastScheduledAt: '2026-09-24T00:10:00Z' })).toBe(false)
    expect(isDue({ ...base, frequency: 'weekly', lastScheduledAt: '2026-09-18T00:10:00Z' })).toBe(true)
    expect(isDue({ ...base, window: 'morning', frequency: 'daily', lastScheduledAt: null })).toBe(false)
  })
})

describe('akkoord nodig?', () => {
  it('gewone updates niet; grote versiesprongen wel', () => {
    expect(approvalReason(comp())).toBeNull()
    expect(approvalReason(comp({ version: '1.2.0', latest_version: '1.2.1' }))).toBeNull()
    expect(approvalReason(comp({ version: '2026.2', latest_version: '2026.3' }))).toBeNull()          // datumversies
    expect(approvalReason(comp({ version: '2.7.11', latest_version: '3.0.0' }))).toBe('major')        // WP Carousel
    expect(approvalReason(comp({ version: '1.10.2.1', latest_version: '2.0.2.1' }))).toBe('major')    // WPForms Lite
    expect(approvalReason(comp({ version: 'dev', latest_version: '1.0' }))).toBe('unknown_version')
  })
  it('WordPress: onderhoudsrelease automatisch, hoofdversie niet', () => {
    expect(approvalReason(comp({ type: 'core', slug: 'wordpress', version: '7.1.2', latest_version: '7.1.3' }))).toBeNull()
    expect(approvalReason(comp({ type: 'core', slug: 'wordpress', version: '7.1.2', latest_version: '7.2' }))).toBe('core_major')
    expect(approvalReason(comp({ type: 'core', slug: 'wordpress', version: '6.9', latest_version: '7.0' }))).toBe('core_major')
  })
  it('de connector zelf altijd automatisch', () => {
    expect(approvalReason(comp({ slug: CONNECTOR_SLUG, version: '2.4.0', latest_version: '3.0.0' }))).toBeNull()
  })
})

describe('eerdere pogingen', () => {
  it('nooit geprobeerd → automatisch', () => {
    expect(decide(comp(), [])).toEqual({ kind: 'auto' })
    expect(decide(comp(), [run([item({ to_version: '1.2.5' })], 'blocked')])).toEqual({ kind: 'auto' })   // andere versie
  })
  it('licentie/pakket ontbreekt → niet opnieuw', () => {
    expect(decide(comp(), [run([item({ staging: 'no_package' }), item({ slug: 'y/y.php', staging: 'updated', production: 'updated' })], 'deployed')]))
      .toEqual({ kind: 'held', why: 'attention' })
  })
  it('alleen tegengehouden → niet opnieuw; in een groep → nog eens apart', () => {
    expect(decide(comp(), [run([item({ staging: 'updated' })], 'blocked')])).toEqual({ kind: 'held', why: 'failed' })
    expect(decide(comp(), [run([item({ staging: 'updated', production: 'updated' })], 'rolled_back')])).toEqual({ kind: 'held', why: 'failed' })
    expect(decide(comp(), [run([item({ staging: 'updated' }), item({ slug: 'y/y.php', staging: 'updated' })], 'blocked')])).toEqual({ kind: 'retry_alone' })
  })
  it('grote versiesprong die in een groep werd teruggedraaid: nog steeds eerst akkoord, geen automatische herkansing', () => {
    const major = comp({ version: '2.7.11', latest_version: '3.0.0' })
    const group = run([item({ from_version: '2.7.11', to_version: '3.0.0', staging: 'updated', production: 'updated' }), item({ slug: 'y/y.php', staging: 'updated', production: 'updated' })], 'rolled_back')
    expect(decide(major, [group])).toEqual({ kind: 'approval', why: 'major' })
  })
})

describe('wat Verploy van alle sites weet', () => {
  it('versie die elders vaak misging: niet zelf, eerst akkoord; bewezen versie: gewoon automatisch', () => {
    const intel = new Map([['plugin:x/x.php:1.3.0', { ok: 5, failed: 3 }]])
    expect(decide(comp(), [], intel)).toEqual({ kind: 'approval', why: 'risky' })
    expect(decide(comp(), [], new Map([['plugin:x/x.php:1.3.0', { ok: 212, failed: 0 }]]))).toEqual({ kind: 'auto' })
    expect(plan([comp()], [], new Set(), intel).approvals[0]!.why).toBe('risky')
  })
})

describe('plan', () => {
  it('gewone updates samen, lekken voorop; grote sprongen als vraag', () => {
    const p = plan([
      comp({ slug: 'a/a.php', name: 'A' }),
      comp({ slug: 'b/b.php', name: 'B', version: '2.7.11', latest_version: '3.0.0' }),
      comp({ slug: 'c/c.php', name: 'C' }),
      comp({ slug: CONNECTOR_SLUG, name: 'Verploy Connector', version: '2.3.0', latest_version: '2.4.0' }),
    ], [], new Set(['plugin:c/c.php']))
    expect(p.run.map(i => i.slug)).toEqual(['c/c.php', CONNECTOR_SLUG, 'a/a.php'])
    expect(p.approvals).toEqual([{ type: 'plugin', slug: 'b/b.php', name: 'B', from_version: '2.7.11', to_version: '3.0.0', why: 'major' }])
    expect(p.retry).toBe(false)
  })
  it('geen gewone updates: één eerder in een groep tegengehouden update apart (herkansing)', () => {
    const failed = run([item({ slug: 'a/a.php', staging: 'updated' }), item({ slug: 'b/b.php', staging: 'updated' })], 'blocked')
    const p = plan([comp({ slug: 'a/a.php', name: 'A' }), comp({ slug: 'b/b.php', name: 'B' })], [failed], new Set())
    expect(p.run).toEqual([{ type: 'plugin', slug: 'a/a.php' }])
    expect(p.retry).toBe(true)
    // a bleek alleen ook te falen → vastgehouden; nu is b aan de beurt.
    const p2 = plan([comp({ slug: 'a/a.php', name: 'A' }), comp({ slug: 'b/b.php', name: 'B' })], [failed, run([item({ slug: 'a/a.php', staging: 'updated' })], 'blocked')], new Set())
    expect(p2.run).toEqual([{ type: 'plugin', slug: 'b/b.php' }])
    expect(p2.held).toEqual([{ type: 'plugin', slug: 'a/a.php', why: 'failed' }])
  })
  it('hoogstens 20 per run', () => {
    const many = Array.from({ length: 25 }, (_, i) => comp({ slug: `p${i}/p.php`, name: `P${String(i).padStart(2, '0')}` }))
    expect(plan(many, [], new Set()).run).toHaveLength(20)
  })
})
