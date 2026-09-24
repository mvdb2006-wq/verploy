/**
 * Wat een bezoeker van verploy.com meeneemt naar de app: het gekozen plan (?plan=) en de taal (?lang=,
 * of: hij komt van de Engelstalige marketingsite). Puur, zodat het met tests is vast te leggen.
 *
 * Het plan uit de URL is nooit een autorisatiebron: het is alleen een voorkeur. Welke plannen bestaan,
 * wat ze kosten en welke limieten erbij horen, bepaalt de server uit de tabel `plans`.
 */
import { isLocale, type Locale } from '@/lib/i18n/core'

/** Vorm van een plancode (zoals `plans.id`); al het andere wordt genegeerd. */
export function normalizePlanParam(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return /^[a-z][a-z0-9_]{0,31}$/.test(v) ? v : null
}

/** Het gekozen plan, alleen als het een bestaand, openbaar plan is (anders: geen keuze, geen foutmelding). */
export function pickPlan<T extends { id: string }>(value: unknown, publicPlans: T[]): T | null {
  const id = normalizePlanParam(value)
  return id ? publicPlans.find(p => p.id === id) ?? null : null
}

/** Hosts van de (Engelstalige) marketingsite. */
const MARKETING_HOSTS = ['verploy.com', 'www.verploy.com']

/**
 * Taal voor het instappunt: een geldige ?lang= wint; anders, als de bezoeker van de Engelstalige
 * marketingsite komt, Engels; anders null (dan geldt de bestaande logica: cookie, browsertaal).
 */
export function entryLocale(lang: string | null | undefined, referer: string | null | undefined): Locale | null {
  const l = (lang ?? '').trim().toLowerCase().slice(0, 2)
  if (isLocale(l)) return l
  if (!referer) return null
  try {
    return MARKETING_HOSTS.includes(new URL(referer).hostname.toLowerCase()) ? 'en' : null
  } catch {
    return null
  }
}
