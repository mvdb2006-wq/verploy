import { describe, expect, it } from 'vitest'
import { createTranslator, interpolate, LOCALES, MESSAGES, negotiateLocale } from './core'

function flatten(obj: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === 'string') out[prefix + k] = v
    else Object.assign(out, flatten(v, `${prefix}${k}.`))
  }
  return out
}
const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)(?:\}|, plural,)/g)].map(m => m[1]))].sort()

describe('i18n: alle vijf talen volledig', () => {
  const base = flatten(MESSAGES.nl)
  for (const locale of LOCALES) {
    const msgs = flatten(MESSAGES[locale])
    it(`${locale}: exact dezelfde sleutels als nl`, () => {
      expect(Object.keys(msgs).sort()).toEqual(Object.keys(base).sort())
    })
    it(`${locale}: geen lege teksten`, () => {
      for (const [k, v] of Object.entries(msgs)) expect(v.trim(), k).not.toBe('')
    })
    it(`${locale}: dezelfde {variabelen} als nl`, () => {
      for (const [k, v] of Object.entries(base)) expect(vars(msgs[k] ?? ''), k).toEqual(vars(v))
    })
  }
  it('vertalingen zijn niet stiekem Nederlands gebleven', () => {
    const nl = flatten(MESSAGES.nl)
    // Teksten die in die taal écht identiek zijn aan het Nederlands.
    // Alleen variabelen en leestekens: in elke taal hetzelfde.
    const placeholdersOnly = ['runs.reason.check.php_error', 'runs.events.item_updated', 'runs.events.item_failed', 'report.period', 'digest.line', 'digest.lineReason']
    const identicalOk: Partial<Record<string, string[]>> = {
      en: ['dashboard.summary', 'ops.security.affected', 'email.alertSubject', 'alerts.types.site_offline.title', 'report.health.pendingCount', ...placeholdersOnly],
      de: ['email.alertSubject', 'alerts.diagnosis', ...placeholdersOnly], fr: ['email.alertSubject', 'ops.security.affected', ...placeholdersOnly], es: ['email.alertSubject', ...placeholdersOnly],
    }
    for (const locale of LOCALES.filter(l => l !== 'nl')) {
      const m = flatten(MESSAGES[locale])
      const same = Object.keys(nl).filter(k => nl[k] === m[k] && nl[k]!.length > 12 && !identicalOk[locale]?.includes(k))
      expect(same, locale).toEqual([])
    }
  })
})

describe('i18n: vertalen', () => {
  it('interpoleert variabelen en laat onbekende staan', () => {
    expect(interpolate('Hallo {naam}, {x}', { naam: 'Martijn' })).toBe('Hallo Martijn, {x}')
  })
  it('vertaalt per taal', () => {
    expect(createTranslator('de')('nav.signOut')).toBe('Abmelden')
    expect(createTranslator('nl')('nav.sites')).toBe('Sites')
  })
  it('meervoud per taal (Intl.PluralRules)', () => {
    const nl = createTranslator('nl'), fr = createTranslator('fr'), de = createTranslator('de')
    expect(nl('dashboard.summary', { count: 1, online: 1 })).toBe('1 site · 1 online')
    expect(nl('dashboard.summary', { count: 3, online: 2 })).toBe('3 sites · 2 online')
    expect(nl('dashboard.trialBanner', { days: 1 })).toBe('Proefperiode: nog 1 dag.')
    expect(fr('siteDetail.updatesAvailable', { count: 0 })).toBe('0 mise à jour disponible')  // Frans: 0 is enkelvoud
    expect(de('siteDetail.updatesAvailable', { count: 2 })).toBe('2 Updates verfügbar')
  })
  it('kiest taal uit Accept-Language', () => {
    expect(negotiateLocale('fr-BE,fr;q=0.9,en;q=0.8')).toBe('fr')
    expect(negotiateLocale('pt-BR,en;q=0.5')).toBe('en')
    expect(negotiateLocale('ja')).toBe('en')
    expect(negotiateLocale(null)).toBe('en')
  })
})
