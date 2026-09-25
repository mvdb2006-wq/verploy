import { failureKind } from '@/lib/updates/failure'
import type { Locale, MessageKey, Translate } from '@/lib/i18n/core'
import { formatDate } from '@/lib/format'
import { presentReason } from '@/lib/runs'

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
  if (alert.type.startsWith('update_')) {
    vars.items = Array.isArray(p.items) ? p.items.map(str).join(', ') : ''
    vars.reason = presentReason(t, typeof p.reason_key === 'string' ? p.reason_key : null, p.reason_params)
    vars.deployed = Number(p.deployed ?? 0)
    vars.total = Number(p.total ?? 0)
  }
  if (alert.type === 'update_approval') {
    const items = Array.isArray(p.items) ? (p.items as Array<{ name?: unknown; to_version?: unknown }>) : []
    vars.items = items.map(i => `${str(i.name)} ${str(i.to_version)}`.trim()).join(', ')
    vars.count = items.length
  }
  if (alert.type === 'vulnerability') {
    vars.items = Array.isArray(p.items) ? p.items.map(str).join(', ') : ''
    vars.severity = typeof p.max_severity === 'string' ? t(`security.severity.${p.max_severity}` as MessageKey) : ''
  }
  const key = alert.type === 'php_eol' ? (alert.severity === 'critical' ? 'php_eol_past' : 'php_eol_soon')
    : alert.type === 'vulnerability' && p.autofix === true ? 'vulnerability_auto'
    : alert.type === 'update_blocked' && p.partial === true ? 'update_partial'
    : alert.type === 'update_approval' && Array.isArray(p.items) && p.items.some(i => (i as { why?: unknown } | null)?.why === 'risky') ? 'update_approval_risky'
    : alert.type
  const diagnosis = alert.type.startsWith('update_') && typeof p.diagnosis === 'string' && p.diagnosis ? ` ${t('alerts.diagnosis', { text: p.diagnosis })}` : ''
  // Waarom een onderdeel niet kon worden bijgewerkt (licentie, schrijfrechten, …), met wat je eraan doet.
  const rp = (p.reason_params ?? {}) as { failures?: unknown }
  const failures = alert.type.startsWith('update_') && Array.isArray(rp.failures)
    ? (rp.failures as Array<{ name?: unknown; kind?: unknown; message?: unknown }>).filter(f => typeof f.kind === 'string' && FAILURE_KINDS.has(f.kind as string)).slice(0, 3)
      .map(f => ` ${str(f.name)}: ${t(`runs.failure.${failureKind({ kind: f.kind as string, message: typeof f.message === 'string' ? f.message : null })}` as MessageKey)}`).join('')
    : ''
  return {
    title: t(`alerts.types.${key}.title` as MessageKey, vars),
    body: t(`alerts.types.${key}.body` as MessageKey, vars) + failures + diagnosis,
  }
}

const FAILURE_KINDS = new Set(['license', 'no_package', 'download', 'permissions', 'folder_exists', 'bad_package', 'requirements', 'disk_space', 'unknown'])

export const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const
