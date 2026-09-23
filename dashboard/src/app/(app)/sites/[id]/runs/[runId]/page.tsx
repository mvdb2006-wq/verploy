import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, Circle, CircleDashed, LoaderCircle, Stethoscope, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { requireAgency } from '@/lib/session'
import { formatDate, formatTime } from '@/lib/format'
import type { Locale, MessageKey, Translate } from '@/lib/i18n/core'
import { CANCELLABLE, RUN_STEPS, presentReason, runBadge, type RunStep } from '@/lib/runs'
import { RunBadge } from '@/components/RunBadge'
import { Alert } from '@/components/Alert'
import { cn } from '@/lib/cn'
import { AutoRefresh } from '@/components/AutoRefresh'
import { CancelRun } from './cancel'

export async function generateMetadata() {
  return { title: (await getT())('runs.detail.title') }
}

interface Item { type: string; slug: string; name: string; from_version: string | null; to_version: string | null; staging?: string; production?: string }
interface Result {
  phase: string; page_key: string; page_label: string; page_url: string; viewport: string; http_status: number | null
  passed: boolean; checks: unknown; screenshot_path: string | null; diff_path: string | null; diff_ratio: number | null
}
interface CheckRow { check: string; ok: boolean; detail?: Record<string, unknown> }

const artifact = (runId: string, path: string | null) => (path ? `/artifacts/${runId}?p=${encodeURIComponent(path)}` : null)

function eventText(t: Translate, key: string, step: string, params: unknown): string {
  const p = (params ?? {}) as Record<string, unknown>
  const vars: Record<string, string | number> = { step: t(`runs.steps.${step}` as MessageKey) }
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'string' || typeof v === 'number') vars[k] = v
    else if (Array.isArray(v)) vars[k] = v.map(String).join(', ')
  }
  if (typeof p.step === 'string') vars.step = t(`runs.steps.${p.step}` as MessageKey)
  if (typeof p.status === 'string') vars.status = t(`runs.itemStatus.${p.status}` as MessageKey)
  if (typeof p.viewport === 'string') vars.viewport = t(`runs.viewport.${p.viewport}` as MessageKey)
  return t(`runs.events.${key.slice(4).replace(/\./g, '_')}` as MessageKey, vars)
}

function Shot({ src, label }: { src: string | null; label: string }) {
  if (!src) return null
  return (
    <figure className="min-w-0 space-y-1">
      <figcaption className="text-xs font-semibold text-muted">{label}</figcaption>
      <a href={src} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-md border border-border bg-bg">
        {/* eslint-disable-next-line @next/next/no-img-element -- privé-afbeelding via eigen route, geen optimalisatie nodig */}
        <img src={src} alt={label} loading="lazy" className="max-h-96 w-full object-cover object-top" />
      </a>
    </figure>
  )
}

function ComparisonTable({ t, runId, after, before, beforeLabel, afterLabel }: {
  t: Translate; runId: string; after: Result[]; before: Result[]; beforeLabel: string; afterLabel: string
}) {
  const pages = [...new Map(after.map(r => [r.page_key, r])).values()]
  const find = (list: Result[], key: string, vp: string) => list.find(r => r.page_key === key && r.viewport === vp)
  return (
    <ul className="divide-y divide-border/60">
      {pages.map(p => {
        const rows = ['desktop', 'mobile'].map(vp => ({ vp, a: find(after, p.page_key, vp), b: find(before, p.page_key, vp) })).filter(x => x.a)
        const failed = rows.flatMap(x => ((x.a!.checks ?? []) as CheckRow[]).filter(c => !c.ok).map(c => ({ ...c, vp: x.vp })))
        const ok = rows.every(x => x.a!.passed)
        return (
          <li key={p.page_key} className="px-5 py-3">
            <details className="group" open={!ok}>
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 marker:hidden">
                <span className="flex min-w-0 items-center gap-2">
                  {ok ? <Check size={16} className="shrink-0 text-accent" aria-label={t('runs.detail.passed')} /> : <X size={16} className="shrink-0 text-danger" aria-label={t('runs.detail.failed')} />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.page_key === 'login' ? t('runs.detail.loginPage') : p.page_label || p.page_key}</span>
                    <span className="block truncate font-mono text-xs text-subtle">{p.page_url}</span>
                  </span>
                </span>
                <span className="flex gap-2 text-xs text-muted">
                  {rows.map(x => (
                    <span key={x.vp} className={cn('badge', x.a!.passed ? 'badge-ok' : 'badge-danger')}>
                      {t(`runs.viewport.${x.vp}` as MessageKey)}{x.a!.diff_ratio != null ? ` · ${(Number(x.a!.diff_ratio) * 100).toFixed(1)}%` : ''}
                    </span>
                  ))}
                </span>
              </summary>
              {failed.length > 0 && (
                <ul className="mt-2 space-y-1 pl-6 text-sm text-danger">
                  {failed.map((c, i) => (
                    <li key={i}>
                      {t(`runs.viewport.${c.vp}` as MessageKey)}: {presentReason(t, `run.reason.check.${c.check}`, { ...c.detail, page: p.page_label, viewport: c.vp })}
                    </li>
                  ))}
                </ul>
              )}
              {rows.some(x => x.a!.screenshot_path) && (
                <div className="mt-3 space-y-4 pl-6">
                  {rows.filter(x => x.a!.screenshot_path).map(x => (
                    <div key={x.vp}>
                      <p className="mb-1.5 text-xs font-bold tracking-wide text-subtle uppercase">{t(`runs.viewport.${x.vp}` as MessageKey)}</p>
                      <div className={cn('grid gap-3', x.vp === 'mobile' ? 'grid-cols-3 sm:max-w-xl' : 'sm:grid-cols-3')}>
                        <Shot src={artifact(runId, x.b?.screenshot_path ?? null)} label={beforeLabel} />
                        <Shot src={artifact(runId, x.a!.screenshot_path)} label={afterLabel} />
                        <Shot src={artifact(runId, x.a!.diff_path)} label={t('runs.detail.diff')} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </details>
          </li>
        )
      })}
    </ul>
  )
}

function Steps({ t, status, started, failedSteps }: { t: Translate; status: string; started: Set<string>; failedSteps: Set<string> }) {
  const done = status === 'done'
  const visible = RUN_STEPS.filter(s => s !== 'rollback' || started.has('rollback'))
  const currentIndex = visible.indexOf(status as RunStep)
  return (
    <ol className="space-y-2">
      {visible.map((s, i) => {
        const state = failedSteps.has(s) ? 'failed'
          : !done && s === status ? 'active'
          : started.has(s) && (done || i < currentIndex) ? 'done'
          : done ? 'skipped' : 'pending'
        return (
          <li key={s} className="flex items-center gap-3 text-sm" aria-current={state === 'active' ? 'step' : undefined}>
            {state === 'done' && <Check size={16} className="shrink-0 text-accent" aria-hidden />}
            {state === 'active' && <LoaderCircle size={16} className="shrink-0 animate-spin text-accent" aria-hidden />}
            {state === 'failed' && <X size={16} className="shrink-0 text-danger" aria-hidden />}
            {state === 'pending' && <Circle size={16} className="shrink-0 text-subtle" aria-hidden />}
            {state === 'skipped' && <CircleDashed size={16} className="shrink-0 text-subtle/60" aria-hidden />}
            <span className={cn({ 'text-subtle': state === 'pending' || state === 'skipped', 'font-semibold': state === 'active', 'text-danger': state === 'failed' })}>
              {t(`runs.steps.${s}` as MessageKey)}
              {state === 'skipped' && <span className="ml-1.5 text-xs">({t('runs.detail.skipped')})</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

interface DiagnosisRow { source: string; model: string | null; summary: string; cause: string; fix: string; culprit_name: string | null; confidence: string; evidence: unknown }

function DiagnosisCard({ t, d }: { t: Translate; d: DiagnosisRow }) {
  const fatal = ((d.evidence as { fatals?: { message: string; file: string; line: number }[] } | null)?.fatals ?? [])[0]
  return (
    <section className="rounded-(--radius-card) border border-warn/30 bg-surface" aria-labelledby="diagnosis-title">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <Stethoscope size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0">
            <h2 id="diagnosis-title" className="font-bold">{t('diagnosis.ui.title')}</h2>
            <p className="mt-1 text-sm">{d.summary}</p>
          </div>
        </div>
        <span className="badge badge-muted">{t(`diagnosis.ui.confidence.${d.confidence}` as MessageKey)}</span>
      </header>
      <div className="grid gap-5 px-5 py-4 md:grid-cols-2">
        <div>
          <h3 className="label">{t('diagnosis.ui.cause')}</h3>
          <p className="text-sm leading-relaxed whitespace-pre-line text-text/90">{d.cause}</p>
          {d.culprit_name && <p className="mt-2 text-xs text-muted">{t('diagnosis.ui.culprit')}: <span className="font-semibold text-text">{d.culprit_name}</span></p>}
        </div>
        <div>
          <h3 className="label">{t('diagnosis.ui.fix')}</h3>
          <p className="text-sm leading-relaxed whitespace-pre-line text-text/90">{d.fix}</p>
        </div>
      </div>
      {fatal && (
        <details className="border-t border-border px-5 py-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted">{t('diagnosis.ui.evidence')}</summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-bg p-3 font-mono text-xs whitespace-pre-wrap text-danger/90">{fatal.message}{'\n'}{fatal.file}:{fatal.line}</pre>
        </details>
      )}
      <p className="border-t border-border px-5 py-2.5 text-xs text-subtle">
        {d.source === 'ai' ? t('diagnosis.ui.sourceAi', { model: d.model ?? '' }) : t('diagnosis.ui.sourceRules')}
      </p>
    </section>
  )
}

function duration(from: string | null, to: string | null, locale: Locale): string | null {
  if (!from) return null
  const ms = (to ? Date.parse(to) : Date.now()) - Date.parse(from)
  const min = Math.floor(ms / 60_000)
  const sec = Math.round((ms % 60_000) / 1000)
  return new Intl.NumberFormat(locale).format(min) + ':' + String(sec).padStart(2, '0')
}

export default async function RunPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(runId)) notFound()
  await requireAgency()
  const [t, locale, supabase] = await Promise.all([getT(), getLocale(), createClient()])
  const { data: run } = await supabase.from('update_runs').select('*').eq('id', runId).eq('site_id', id).maybeSingle()
  if (!run) notFound()
  const [{ data: site }, { data: events }, { data: results }, { data: diagnosis }] = await Promise.all([
    supabase.from('sites').select('id, name, url').eq('id', id).single(),
    supabase.from('update_run_events').select('id, step, level, message_key, params, created_at').eq('run_id', runId).order('id'),
    supabase.from('test_results').select('phase, page_key, page_label, page_url, viewport, http_status, passed, checks, screenshot_path, diff_path, diff_ratio').eq('run_id', runId).order('id'),
    supabase.from('diagnoses').select('source, model, summary, cause, fix, culprit_name, confidence, evidence').eq('run_id', runId).maybeSingle(),
  ])
  const items = run.items as unknown as Item[]
  const badge = runBadge(t, run)
  const done = run.status === 'done'
  const started = new Set((events ?? []).filter(e => e.message_key === 'run.step.started').map(e => e.step))
  if (!done) started.add(run.status)
  const FAILED_KEYS = ['run.step.failed', 'run.staging.failed', 'run.postcheck.failed', 'run.item.failed', 'run.item.crashed', 'run.rollback.still_broken']
  const failedSteps = new Set((events ?? []).filter(e => FAILED_KEYS.includes(e.message_key)).map(e => e.step))
  const byPhase = (phase: string) => ((results ?? []) as Result[]).filter(r => r.phase === phase)
  const reason = presentReason(t, run.reason_key, run.reason_params)
  const outcomeTone = { deployed: 'ok', blocked: 'warn', rolled_back: 'danger', error: 'danger', cancelled: 'info' } as const

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {!done && <AutoRefresh seconds={3} />}
      <div>
        <Link href={`/sites/${id}`} className="text-sm text-muted hover:text-text">← {site?.name ?? t('siteDetail.back')}</Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight">{t('runs.detail.title')}</h1>
            <p className="mt-1 text-sm text-muted">
              {t('runs.detail.startedAt', { date: formatDate(run.created_at, locale, true) })}
              {run.started_at && ` · ${t('runs.detail.duration', { time: duration(run.started_at, run.finished_at, locale) ?? '' })}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <RunBadge {...badge} className="px-3 py-1 text-sm" />
            {!done && CANCELLABLE.includes(run.status) && !run.cancel_requested && <CancelRun runId={run.id} siteId={id} />}
          </div>
        </div>
      </div>

      {done && run.verdict && (
        <Alert tone={outcomeTone[run.verdict as keyof typeof outcomeTone] ?? 'info'}>
          <strong>{t(`runs.outcome.${run.verdict}` as MessageKey)}</strong>{reason ? ` ${reason}` : ''}
        </Alert>
      )}
      {!done && run.cancel_requested && <Alert tone="info">{t('runs.detail.cancelling')}</Alert>}

      {diagnosis && <DiagnosisCard t={t} d={diagnosis} />}

      <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
        <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="items-title">
          <h2 id="items-title" className="border-b border-border px-5 py-4 font-bold">{t('runs.detail.items')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="px-5 py-2 font-semibold">{t('runs.detail.component')}</th><th className="px-3 py-2 font-semibold">{t('runs.detail.version')}</th><th className="px-3 py-2 font-semibold">{t('runs.detail.staging')}</th><th className="px-5 py-2 font-semibold">{t('runs.detail.production')}</th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {items.map(i => (
                  <tr key={`${i.type}:${i.slug}`}>
                    <td className="px-5 py-2.5 font-medium">{i.name}</td>
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{i.from_version ?? '—'} → {i.to_version ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs">{i.staging ? t(`runs.itemStatus.${i.staging}` as MessageKey) : '—'}</td>
                    <td className="px-5 py-2.5 text-xs">{i.production ? t(`runs.itemStatus.${i.production}` as MessageKey) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card" aria-labelledby="steps-title">
          <h2 id="steps-title" className="mb-4 font-bold">{t('runs.detail.steps')}</h2>
          <Steps t={t} status={run.status} started={started} failedSteps={failedSteps} />
        </section>
      </div>

      {byPhase('staging_after').length > 0 && (
        <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="staging-title">
          <header className="border-b border-border px-5 py-4">
            <h2 id="staging-title" className="font-bold">{t('runs.detail.stagingTests')}</h2>
            <p className="mt-0.5 text-xs text-muted">{t('runs.detail.stagingTestsIntro')}</p>
          </header>
          <ComparisonTable t={t} runId={run.id} after={byPhase('staging_after')} before={byPhase('staging_before')} beforeLabel={t('runs.detail.beforeUpdate')} afterLabel={t('runs.detail.afterUpdate')} />
        </section>
      )}
      {byPhase('production_after').length > 0 && (
        <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="prod-title">
          <header className="border-b border-border px-5 py-4">
            <h2 id="prod-title" className="font-bold">{t('runs.detail.productionTests')}</h2>
            <p className="mt-0.5 text-xs text-muted">{t('runs.detail.productionTestsIntro')}</p>
          </header>
          <ComparisonTable t={t} runId={run.id} after={byPhase('production_after')} before={byPhase('production_before')} beforeLabel={t('runs.detail.beforeUpdate')} afterLabel={t('runs.detail.afterUpdate')} />
        </section>
      )}

      <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="timeline-title">
        <h2 id="timeline-title" className="border-b border-border px-5 py-4 font-bold">{t('runs.detail.timeline')}</h2>
        <ol className="divide-y divide-border/60">
          {(events ?? []).map(e => (
            <li key={e.id} className="flex gap-4 px-5 py-2.5 text-sm">
              <time className="shrink-0 font-mono text-xs text-subtle tabular-nums" dateTime={e.created_at}>{formatTime(e.created_at, locale)}</time>
              <span className={cn({ 'text-warn': e.level === 'warning', 'text-danger': e.level === 'error' })}>
                {eventText(t, e.message_key, e.step, e.params)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
