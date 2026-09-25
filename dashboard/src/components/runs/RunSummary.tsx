import { ExternalLink } from 'lucide-react'
import type { MessageKey, Translate } from '@/lib/i18n/core'
import { adviceFor, summarizeRun, type RunItem } from '@/lib/run-items'
import { presentReason } from '@/lib/runs'
import { cn } from '@/lib/cn'
import { failureKind } from '@/lib/updates/failure'
import { WpAdminLink } from '@/components/WpAdminLink'

interface RunLike { status: string; verdict: string | null; reason_key: string | null; reason_params: unknown; items: unknown }

const TONE = {
  ok: 'border-accent/30 bg-accent/5', warn: 'border-warn/40 bg-warn/5', danger: 'border-danger/40 bg-danger/5', info: 'border-border bg-surface',
} as const

const list = (items: RunItem[]) => items.map(i => i.name).join(', ')

/**
 * De uitkomst van een afgeronde veilige update in gewone taal: wat is gelukt, wat niet en waarom,
 * wat Verploy besloot, of de live site is geraakt, en wat (als er iets is) de gebruiker moet doen.
 */
export function RunSummary({ t, run, siteId, siteUrl, wpLogin = false, hasDiagnosis }: { t: Translate; run: RunLike; siteId: string; siteUrl: string; wpLogin?: boolean; hasDiagnosis: boolean }) {
  if (run.status !== 'done' || !run.verdict) return null
  const items = (run.items ?? []) as RunItem[]
  const s = summarizeRun(items, run)
  const partial = run.verdict === 'deployed' && (s.attention.length > 0 || s.skipped.length > 0)
  const params = (run.reason_params ?? {}) as Record<string, unknown>

  const headline = run.verdict === 'deployed'
    ? partial ? t('runs.summary.headlinePartial', { deployed: s.live.length, total: s.total }) : t('runs.summary.headlineAll', { count: s.total })
    : t(`runs.summary.headline${({ blocked: 'Blocked', rolled_back: 'RolledBack', error: 'Error', cancelled: 'Cancelled' } as const)[run.verdict as 'blocked'] ?? 'Error'}` as MessageKey)
  const tone = run.verdict === 'deployed' ? (partial ? 'warn' : 'ok') : run.verdict === 'blocked' ? 'warn' : run.verdict === 'cancelled' ? 'info' : 'danger'

  const lines: string[] = []
  if (run.verdict === 'deployed' && s.live.length) lines.push(t('runs.summary.live', { names: list(s.live) }))
  for (const i of s.attention) lines.push(t('runs.summary.itemFailed', { name: i.name, status: t(`runs.itemStatus.${i.staging}` as MessageKey) }))
  if (s.skipped.length) lines.push(t('runs.summary.skipped', { count: s.skipped.length, names: list(s.skipped) }))
  if (run.verdict !== 'deployed') {
    const tested = Number(params.tested ?? 0)
    if (run.reason_key === 'run.reason.update_crashed') lines.push(t('runs.summary.crashStopped', { name: String(params.name ?? '') }))
    else if (run.reason_key === 'run.reason.update_failed' && s.heldBack.length) lines.push(t('runs.summary.uncleanStopped', { name: String(params.name ?? '') }))
    else if (run.reason_key?.startsWith('run.reason.check.') && tested > 1) {
      lines.push(presentReason(t, run.reason_key, run.reason_params), t('runs.summary.batchStopped', { count: tested }))
    } else if (!(run.reason_key === 'run.reason.update_failed' && s.attention.length)) {
      const reason = presentReason(t, run.reason_key, run.reason_params)
      if (reason) lines.push(reason)
    }
  }
  const live = run.verdict === 'deployed' ? t('runs.summary.liveOk')
    : run.verdict === 'rolled_back' ? t('runs.summary.liveRestored')
    : run.verdict === 'error' && s.liveTouched ? null
    : t('runs.summary.liveUntouched')

  // Aanbevolen actie: per onderdeel dat aandacht vraagt; anders de diagnose (staat eronder) of niets.
  // Is de oorzaak bekend (logboek van WordPress), dan die uitleg; anders het advies op basis van de status.
  const advice = [...s.attention, ...s.skipped].slice(0, 4).map(i => i.failure && failureKind(i.failure) !== 'unknown'
    ? `${i.name}: ${t(`runs.failure.${failureKind(i.failure)}` as MessageKey)}`
    : t(`runs.advice.${adviceFor(i.staging)}` as MessageKey, { name: i.name }))
  const needsUser = advice.length > 0 || (run.verdict !== 'deployed' && run.verdict !== 'cancelled')

  return (
    <section className={cn('rounded-(--radius-card) border px-5 py-4', TONE[tone])} aria-labelledby="summary-title" role="status">
      <h2 id="summary-title" className="text-lg font-bold">{headline}</h2>
      <ul className="mt-2 space-y-1 text-sm [overflow-wrap:anywhere]">
        {lines.map((l, n) => <li key={n}>{l}</li>)}
        {live && <li className="font-semibold">{live}</li>}
      </ul>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-border/60 pt-3">
        <div className="min-w-0 flex-1 basis-72 text-sm">
          {advice.length > 0 ? (
            <>
              <p className="font-semibold">{t('runs.summary.recommended')}</p>
              <ul className="mt-1 space-y-1 text-text/90">{advice.map((a, n) => <li key={n}>{a}</li>)}</ul>
            </>
          ) : !needsUser ? <p className="text-muted">{t('runs.summary.noAction')}</p>
            : hasDiagnosis ? null
            : <p className="text-muted">{t('runs.advice.review', { name: list(s.heldBack.length ? s.heldBack : items) })}</p>}
        </div>
        {needsUser && (
          <WpAdminLink siteId={siteId} siteUrl={siteUrl} sso={wpLogin} className="btn btn-ghost shrink-0">
            {t('runs.summary.openWpAdmin')} <ExternalLink size={14} aria-hidden />
          </WpAdminLink>
        )}
      </div>
    </section>
  )
}
