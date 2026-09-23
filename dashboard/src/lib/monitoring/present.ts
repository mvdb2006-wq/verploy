import type { Locale, MessageKey, Translate } from '@/lib/i18n/core'
import { formatDate } from '@/lib/format'

export interface AlertLike { type: string; severity: string; params: unknown }

type Params = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

/** Titel en uitleg van een melding in de taal van het bureau (UI én e-mail). */
export function presentAlert(t: Translate, locale: Locale, alert: AlertLike): { title: string; body: string } {
  const p = (alert.params ?? {}) as Params
  const date = (v: unknown) => (v ? formatDate(str(v), locale) : '—')
  const vars: Record<string, string | number> = {
    since: p.since ? formatDate(str(p.since), locale, true) : '—',
    days: Number(p.days ?? 0),
    date: date(p.expires_at ?? p.eol),
    version: str(p.version),
    mb: Number(p.mb ?? 0),
    count: Number(p.count ?? 0),
    reason: p.error ? t(`alerts.sslError.${str(p.error)}` as MessageKey) : '',
  }
  const key = alert.type === 'php_eol' ? (alert.severity === 'critical' ? 'php_eol_past' : 'php_eol_soon') : alert.type
  return {
    title: t(`alerts.types.${key}.title` as MessageKey, vars),
    body: t(`alerts.types.${key}.body` as MessageKey, vars),
  }
}

export const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const
