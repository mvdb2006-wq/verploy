import { describe, expect, it } from 'vitest'
import { createTranslator } from '@/lib/i18n/core'
import type { RunItem } from '@/lib/run-items'
import { buildDigest, type DigestRun } from './build'

const t = createTranslator('nl')
const item = (name: string, to: string, over: Partial<RunItem> = {}): RunItem =>
  ({ type: 'plugin', slug: `${name.toLowerCase()}/x.php`, name, from_version: '1.0', to_version: to, staging: 'updated', production: 'updated', ...over })
const run = (over: Partial<DigestRun>): DigestRun =>
  ({ siteName: 'Borgo Vista Serena', status: 'done', verdict: 'deployed', trigger: 'scheduled', items: [], reasonKey: null, reasonParams: null, ...over })

describe('ochtendmail', () => {
  it('niets gebeurd en niets wacht → geen mail', () => {
    expect(buildDigest(t, { agencyName: 'EM', runs: [], decisions: 0, problems: 0 })).toBeNull()
  })

  it('live gezet en tegengehouden, per site, met reden; plus wat wacht', () => {
    const d = buildDigest(t, {
      agencyName: 'EM Hosting', decisions: 2, problems: 1,
      runs: [
        run({ items: [item('Yoast SEO', '28.6'), item('Akismet', '5.4')] }),
        run({ siteName: 'Feel Good TentEvent', verdict: 'rolled_back', reasonKey: 'run.reason.check.visual',
              reasonParams: { page: 'Home', viewport: 'desktop', ratio: 0.105, threshold: 0.02 }, items: [item('WP Carousel', '2.8')] }),
      ],
    })!
    expect(d.subject).toBe('Afgelopen nacht bij EM Hosting: 2 live, 1 tegengehouden')
    expect(d.heading).toBe('Afgelopen nacht bij EM Hosting')
    expect(d.sections.map(s => s.title)).toEqual(['Live gezet (2)', 'Niet live gezet (1)', 'Wacht op jou (3)'])
    expect(d.sections[0]!.lines).toEqual(['Borgo Vista Serena: Yoast SEO 28.6, Akismet 5.4'])
    expect(d.sections[1]!.lines[0]).toMatch(/^Feel Good TentEvent: WP Carousel 2\.8\. .+/)
    expect(d.sections[2]!.lines).toEqual([
      '2 beslissingen (akkoord op een update of een lek oplossen)', '1 probleem om naar te kijken',
    ])
    expect(d.cta).toBe('Naar de inbox')
  })

  it('rustige nacht, maar er wacht iets → korte herinnering', () => {
    const d = buildDigest(t, { agencyName: 'EM', runs: [], decisions: 1, problems: 0 })!
    expect(d.subject).toBe('EM: 1 punt wacht op je in Verploy')
    expect(d.intro).toBe('Er is niets bijgewerkt, maar dit wacht nog op je.')
  })

  it('lopende runs tellen nog niet mee', () => {
    expect(buildDigest(t, { agencyName: 'EM', runs: [run({ status: 'staging_test', verdict: null, items: [item('X', '2')] })], decisions: 0, problems: 0 })).toBeNull()
  })

  it('Engels', () => {
    const d = buildDigest(createTranslator('en'), { agencyName: 'EM', runs: [run({ items: [item('X', '2')] })], decisions: 0, problems: 0 })!
    expect(d.subject).toBe('Last night at EM: 1 live, 0 held back')
    expect(d.cta).toBe('Go to the overview')
  })
})
