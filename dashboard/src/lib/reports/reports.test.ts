import { describe, expect, it } from 'vitest'
import { createTranslator, LOCALES } from '@/lib/i18n/core'
import { computeUptime, type ReportData } from './model'
import { duration, footerTemplate, renderReportHtml } from './render'

const NOW = Date.parse('2026-09-15T12:00:00Z')

describe('computeUptime', () => {
  it('geen storingen: 100%', () => {
    expect(computeUptime([], '2026-08-01', '2026-08-31', '2026-01-01T00:00:00Z', NOW)).toEqual({ percent: 100, downtimeMinutes: 0, incidents: [] })
  })
  it('storing van 2 uur in een maand van 31 dagen, begin = laatste heartbeat', () => {
    const r = computeUptime([{ opened_at: '2026-08-10T10:45:00Z', resolved_at: '2026-08-10T12:00:00Z', since: '2026-08-10T10:00:00Z' }], '2026-08-01', '2026-08-31', null, NOW)
    expect(r.downtimeMinutes).toBe(120)
    expect(r.percent).toBeCloseTo(100 * (1 - 2 / (31 * 24)), 6)
    expect(r.incidents).toEqual([{ start: '2026-08-10T10:00:00.000Z', minutes: 120 }])
  })
  it('storing over de periodegrens telt alleen binnen de periode; open storing loopt tot nu', () => {
    const r = computeUptime([{ opened_at: '2026-07-31T23:00:00Z', resolved_at: '2026-08-01T01:00:00Z', since: null }], '2026-08-01', '2026-08-31', null, NOW)
    expect(r.downtimeMinutes).toBe(60)
    const open = computeUptime([{ opened_at: '2026-09-15T11:00:00Z', resolved_at: null, since: '2026-09-15T10:30:00Z' }], '2026-09-01', '2026-09-15', null, NOW)
    expect(open.downtimeMinutes).toBe(90)
    expect(open.incidents[0]!.minutes).toBeNull()
  })
  it('gemeten vanaf de koppeling; nog niet gekoppeld in de periode → onbekend', () => {
    expect(computeUptime([], '2026-08-01', '2026-08-31', '2026-10-01T00:00:00Z', NOW).percent).toBeNull()
  })
})

const data = (over: Partial<ReportData> = {}): ReportData => ({
  agency: { name: 'Studio <Noord>', color: '#1D4ED8', logoDataUri: null, sender: 'Studio Noord' },
  site: { name: 'Bakkerij de Vries', url: 'https://bakkerijdevries.nl', client: 'Anna de Vries' },
  period: { start: '2026-08-01', end: '2026-08-31' },
  generatedAt: '2026-09-01T06:00:00Z',
  uptime: { percent: 99.73, downtimeMinutes: 120, incidents: [{ start: '2026-08-10T10:00:00Z', minutes: 120 }] },
  runs: [
    { date: '2026-08-12T09:00:00Z', verdict: 'deployed', items: [{ name: 'Yoast SEO', from: '25.1', to: '25.2' }, { name: 'WooCommerce', from: '10.0.1', to: '10.1.0' }], diagnosis: null },
    { date: '2026-08-20T09:00:00Z', verdict: 'blocked', items: [{ name: 'Slider Pro', from: '4.1', to: '5.0' }], diagnosis: 'Slider Pro 5.0 roept een functie aan die niet bestaat (sp_init).' },
  ],
  health: { wp: '7.1.2', php: '8.1.30', phpEol: { date: '2025-12-31', past: true }, https: true, sslValidUntil: '2026-11-30T00:00:00Z', sslError: null, domainUntil: null, memoryMb: 256, diskFreeMb: 20480, pendingUpdates: 2 },
  attention: [{ title: 'PHP 8.1 krijgt geen beveiligingsupdates meer', body: 'Upgrade naar een ondersteunde PHP-versie.', severity: 'critical' }],
  ...over,
})

describe('renderReportHtml', () => {
  it('toont de kerngegevens in de taal van het rapport, white-label en ge-escaped', () => {
    const html = renderReportHtml(data(), createTranslator('nl'), 'nl')
    expect(html).toContain('<html lang="nl">')
    expect(html).toContain('Onderhoudsrapport')
    expect(html).toContain('1 augustus 2026 – 31 augustus 2026')
    expect(html).toContain('99,73%')
    expect(html).toContain('Yoast SEO')
    expect(html).toContain('Tegengehouden')
    expect(html).toContain('Slider Pro 5.0 roept een functie aan die niet bestaat (sp_init).')
    expect(html).toContain('8.1.30 – geen beveiligingsupdates meer sinds 31 december 2025')
    expect(html).toContain('10 aug 2026')   // storing met datum/tijd
    expect(html).toContain('2 u 0 min')
    expect(html).toContain('--brand: #1D4ED8')
    expect(html).toContain('Studio &lt;Noord&gt;')
    expect(html).not.toContain('Studio <Noord>')
    expect(html.toLowerCase()).not.toContain('verploy')
  })
  it('lege periode: nette lege staten', () => {
    const html = renderReportHtml(data({ runs: [], attention: [], uptime: { percent: 100, downtimeMinutes: 0, incidents: [] } }), createTranslator('en'), 'en')
    expect(html).toContain('No updates were carried out in this period.')
    expect(html).toContain('There are no open points of attention.')
    expect(html).toContain('No interruptions were measured in this period.')
    expect(html).toContain('>100%<')
  })
  it('in alle vijf talen zonder ontbrekende teksten', () => {
    for (const locale of LOCALES) {
      const html = renderReportHtml(data(), createTranslator(locale), locale) + footerTemplate(data(), createTranslator(locale), locale)
      expect(html, locale).not.toMatch(/report\.[a-z]+\.|\{[a-z]+\}/i)
    }
  })
  it('logo alleen als data-URI, onveilige kleur valt terug', () => {
    const html = renderReportHtml(data({ agency: { name: 'X', color: 'red;}body{display:none', logoDataUri: 'data:image/png;base64,AAAA', sender: 'X' } }), createTranslator('de'), 'de')
    expect(html).toContain('<img src="data:image/png;base64,AAAA"')
    expect(html).toContain('--brand: #22D98A')
  })
  it('footer met paginanummers', () => {
    const f = footerTemplate(data(), createTranslator('fr'), 'fr')
    expect(f).toContain('Page <span class="pageNumber"></span> sur <span class="totalPages"></span>')
    expect(f).toContain('Préparé par Studio Noord le 1 septembre 2026')
  })
  it('duur leesbaar', () => {
    expect(duration(45, createTranslator('nl'))).toBe('45 min')
    expect(duration(135, createTranslator('de'))).toBe('2 Std. 15 Min.')
  })
})
