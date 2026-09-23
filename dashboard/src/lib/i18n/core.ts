import nl from '@/locales/nl.json'
import en from '@/locales/en.json'
import de from '@/locales/de.json'
import fr from '@/locales/fr.json'
import es from '@/locales/es.json'

export const LOCALES = ['nl', 'en', 'de', 'fr', 'es'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'nl'
export const DATE_LOCALE_TAG: Record<Locale, string> = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' }

export type Messages = typeof nl
export const MESSAGES: Record<Locale, Messages> = { nl, en, de, fr, es }

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>
}[keyof T & string]

/** Alle geldige vertaalsleutels, bijv. 'auth.login.title'. Typfouten zijn compileerfouten. */
export type MessageKey = Leaves<Messages>
export type Vars = Record<string, string | number>
export type Translate = (key: MessageKey, vars?: Vars) => string

export function isLocale(x: unknown): x is Locale {
  return typeof x === 'string' && (LOCALES as readonly string[]).includes(x)
}

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

const PLURAL = /\{(\w+), plural, ((?:(?:=\d+|zero|one|two|few|many|other) \{[^{}]*\} ?)+)\}/g

/** Vult {var} in en ondersteunt ICU-meervoud: {count, plural, one {# site} other {# sites}}. */
export function interpolate(template: string, vars?: Vars, locale: Locale = DEFAULT_LOCALE): string {
  if (!vars) return template
  const withPlurals = template.replace(PLURAL, (m, name: string, body: string) => {
    if (!(name in vars)) return m
    const n = Number(vars[name])
    const forms = Object.fromEntries([...body.matchAll(/(=\d+|\w+) \{([^{}]*)\}/g)].map(x => [x[1], x[2]]))
    const form = forms[`=${n}`] ?? forms[new Intl.PluralRules(DATE_LOCALE_TAG[locale]).select(n)] ?? forms.other ?? ''
    return form.replace(/#/g, String(n))
  })
  return withPlurals.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

export function createTranslator(locale: Locale): Translate {
  const messages = MESSAGES[locale]
  return (key, vars) => interpolate(lookup(messages, key) ?? lookup(MESSAGES[DEFAULT_LOCALE], key) ?? key, vars, locale)
}

/** Kiest de beste taal uit een Accept-Language-header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE
  const ranked = acceptLanguage
    .split(',')
    .map(part => {
      const [tag, q] = part.trim().split(';q=')
      return { lang: (tag ?? '').slice(0, 2).toLowerCase(), q: q ? Number(q) : 1 }
    })
    .sort((a, b) => b.q - a.q)
  return ranked.find(r => isLocale(r.lang))?.lang as Locale | undefined ?? DEFAULT_LOCALE
}

