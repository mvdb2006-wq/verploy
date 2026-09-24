import type { MessageKey, Translate } from '@/lib/i18n/core'

/** Stappen van een run in volgorde (PLAN.md §5). `rollback` verschijnt alleen als hij nodig was. */
export const RUN_STEPS = [
  'preparing', 'baseline', 'staging_create', 'staging_baseline', 'staging_update', 'staging_test',
  'deploy_snapshot', 'deploy_apply', 'postcheck', 'rollback', 'cleanup',
] as const
export type RunStep = (typeof RUN_STEPS)[number]

export const CANCELLABLE = ['queued', 'preparing', 'baseline', 'staging_create', 'staging_baseline', 'staging_update', 'staging_test']

/** Minimale connectorversie voor veilige updates (zelfde regel als create_update_run). */
export const MIN_CONNECTOR_FOR_RUNS = [2, 1, 0] as const

export function versionAtLeast(version: string | null | undefined, min: readonly number[]): boolean {
  if (!version) return false
  const parts = version.replace(/[^0-9.].*$/, '').split('.').map(n => Number(n) || 0)
  for (let i = 0; i < min.length; i++) {
    const a = parts[i] ?? 0
    const b = min[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

/** Wacht de run op een nieuwe poging (na een tijdelijke fout)? */
export function waitingForRetry(run: { status: string; not_before: string }, now = Date.now()): boolean {
  return run.status !== 'done' && Date.parse(run.not_before) > now
}

export type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'active'

/** Label + kleur voor de status of uitkomst van een run. */
export function runBadge(t: Translate, run: { status: string; verdict: string | null }): { label: string; tone: Tone } {
  if (run.status !== 'done') {
    return { label: run.status === 'queued' ? t('runs.status.queued') : t('runs.status.running'), tone: 'active' }
  }
  const tone: Record<string, Tone> = { deployed: 'ok', blocked: 'warn', rolled_back: 'danger', error: 'danger', cancelled: 'muted' }
  return { label: t(`runs.verdict.${run.verdict ?? 'error'}` as MessageKey), tone: tone[run.verdict ?? 'error'] ?? 'muted' }
}

type Params = Record<string, unknown>

/** Leesbare uitleg van een reden (reason_key + params) — voor run-pagina, meldingen en e-mail. */
export function presentReason(t: Translate, key: string | null | undefined, params: unknown, locale?: string): string {
  if (!key) return ''
  const p = (params ?? {}) as Params
  const vars: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'string' || typeof v === 'number') vars[k] = v
    else if (Array.isArray(v)) vars[k] = v.map(String).join(', ')
  }
  if (typeof p.viewport === 'string') vars.viewport = t(`runs.viewport.${p.viewport}` as MessageKey)
  if (typeof p.viewportLabel === 'string') vars.viewport = p.viewportLabel
  if (typeof p.ratio === 'number') vars.percent = (p.ratio * 100).toLocaleString(locale, { maximumFractionDigits: 1 })
  if (typeof p.threshold === 'number') vars.limit = (p.threshold * 100).toLocaleString(locale, { maximumFractionDigits: 1 })
  if (typeof p.step === 'string') vars.step = t(`runs.steps.${p.step}` as MessageKey)
  if (typeof p.status === 'string' && /^[a-z_]+$/.test(p.status)) {
    const label = t(`runs.itemStatus.${p.status}` as MessageKey)
    if (label !== `runs.itemStatus.${p.status}`) vars.status = label
  }
  if (typeof p.error === 'string' && /^(wp_critical_error|php_fatal|db_connection|maintenance)$/.test(p.error)) {
    vars.error = t(`runs.phpError.${p.error}` as MessageKey)
  }
  const known = key.startsWith('run.reason.') ? `runs.reason.${key.slice('run.reason.'.length)}` : null
  return known ? t(known as MessageKey, vars) : key
}
