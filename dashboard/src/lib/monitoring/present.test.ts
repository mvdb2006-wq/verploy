import { describe, expect, it } from 'vitest'
import { createTranslator } from '@/lib/i18n/core'
import { presentAlert } from './present'

describe('presentAlert', () => {
  const nl = createTranslator('nl')
  it('SSL met dagen en datum (meervoud)', () => {
    const r = presentAlert(nl, 'nl', { type: 'ssl_expiring', severity: 'warning', params: { days: 1, expires_at: '2026-10-01T10:00:00Z' } })
    expect(r.title).toBe('SSL-certificaat verloopt over 1 dag')
    expect(r.body).toContain('1 okt 2026')
    expect(presentAlert(nl, 'nl', { type: 'ssl_expiring', severity: 'critical', params: { days: 0 } }).title).toBe('SSL-certificaat is verlopen')
  })
  it('PHP: verleden vs binnenkort op basis van ernst', () => {
    expect(presentAlert(nl, 'nl', { type: 'php_eol', severity: 'critical', params: { version: '8.1', eol: '2025-12-31' } }).title)
      .toBe('PHP 8.1 krijgt geen beveiligingsupdates meer')
    expect(presentAlert(nl, 'nl', { type: 'php_eol', severity: 'warning', params: { version: '8.2', eol: '2026-12-31' } }).title)
      .toBe('PHP 8.2 krijgt nog beveiligingsupdates tot 31 dec 2026')
  })
  it('SSL-oorzaak wordt vertaald', () => {
    const de = createTranslator('de')
    expect(presentAlert(de, 'de', { type: 'ssl_invalid', severity: 'critical', params: { error: 'self_signed' } }).body)
      .toContain('das Zertifikat ist selbstsigniert')
  })
  it('beveiligingslek: onderdelen, ernst en "automatisch" in de tekst', () => {
    const base = { type: 'vulnerability', severity: 'critical', params: { count: 2, items: ['Akismet', 'Yoast SEO'], max_severity: 'critical', autofix: false } }
    const r = presentAlert(nl, 'nl', base)
    expect(r.title).toBe('2 bekende beveiligingslekken: Akismet, Yoast SEO')
    expect(r.body).toBe('Ernst: Kritiek. Bekijk de site in Verploy en voer de oplossing veilig uit.')
    const auto = presentAlert(nl, 'nl', { ...base, params: { ...base.params, count: 1, items: ['Akismet'], autofix: true } })
    expect(auto.title).toBe('Bekend beveiligingslek: Akismet')
    expect(auto.body).toContain('Verploy lost dit automatisch en veilig op')
  })
  it('update tegengehouden: de status staat in gewone taal, niet als code', () => {
    const r = presentAlert(nl, 'nl', { type: 'update_blocked', severity: 'warning', params: { items: ['Yoast SEO Premium'], reason_key: 'run.reason.update_failed', reason_params: { name: 'Yoast SEO Premium', status: 'no_package' } } })
    expect(r.body).toContain('Yoast SEO Premium kon niet worden bijgewerkt op de testkopie (Geen downloadbestand; is de licentie nog actief?)')
    expect(r.body).not.toContain('no_package')
  })
  it('elk type heeft een titel in elke taal (geen ruwe sleutels)', () => {
    for (const locale of ['nl', 'en', 'de', 'fr', 'es'] as const) {
      const t = createTranslator(locale)
      for (const type of ['site_offline', 'ssl_expiring', 'ssl_invalid', 'ssl_missing', 'domain_expiring', 'php_eol', 'memory_low', 'disk_low', 'core_update', 'plugin_updates', 'vulnerability']) {
        for (const severity of ['warning', 'critical']) {
          const r = presentAlert(t, locale, { type, severity, params: { days: 3, count: 2, mb: 64, version: '8.1', error: 'expired' } })
          expect(r.title, `${locale}/${type}`).not.toMatch(/^alerts\./)
          expect(r.title).not.toMatch(/\{\w+\}|plural/)
        }
      }
    }
  })
})
