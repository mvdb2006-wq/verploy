import Link from 'next/link'
import { ExternalLink, Globe } from 'lucide-react'
import { RunBadge } from '@/components/RunBadge'
import { formatTime } from '@/lib/format'
import { presentAlert } from '@/lib/monitoring/present'
import { runBadge } from '@/lib/runs'
import type { Locale, MessageKey, Translate } from '@/lib/i18n/core'
import { formatDuration, runProgress, uniqueSites, type InboxItem, type SiteState, type VulnGroup } from '@/lib/operations/model'
import type { ActiveRun, ActivityEntry } from '@/lib/operations/load'
import { acknowledgeAlert } from '@/app/(app)/alerts/actions'
import { FixButton } from './FixButton'
import { ApproveUpdatesButton } from './ApproveUpdatesButton'
import { cn } from '@/lib/cn'

const SEVERITY_CLASS = { critical: 'badge-danger', high: 'badge-danger', medium: 'badge-warn', low: 'badge-muted' } as const
const STATE_CLASS: Record<SiteState, string> = {
  fixing: 'bg-accent/10 text-accent', awaiting: 'badge-warn', scheduled: 'bg-accent/10 text-accent',
  blocked: 'badge-danger', fixable: 'badge-muted', manual: 'badge-warn', no_fix: 'badge-danger',
}

export function Severity({ t, severity }: { t: Translate; severity: string }) {
  return <span className={cn('badge shrink-0', SEVERITY_CLASS[severity as keyof typeof SEVERITY_CLASS] ?? 'badge-muted')}>{t(`security.severity.${severity}` as MessageKey)}</span>
}

/** De inbox: beslissingen en problemen, met hoe lang ze al wachten. */
export function InboxList({ items, t, locale, now, limit }: { items: InboxItem[]; t: Translate; locale: Locale; now: number; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items
  return (
    <ul className="divide-y divide-border/60">
      {shown.map(item => {
        const waiting = t('ops.inbox.waiting', { time: formatDuration(now - Date.parse(item.since), t) })
        if (item.kind === 'alert') {
          const a = item.alert
          const { title, body } = presentAlert(t, locale, a)
          const runId = a.type.startsWith('update_') ? (a.params as { run_id?: string } | null)?.run_id : undefined
          const approval = a.type === 'update_approval'
          return (
            <li key={item.key} className="flex flex-wrap items-start gap-3 px-5 py-4">
              <Severity t={t} severity={item.severity} />
              <div className="min-w-0 flex-1 basis-64">
                <SiteNames sites={[{ siteId: a.site_id, siteName: a.siteName }]} t={t} />
                <p className="mt-0.5 text-sm font-semibold [overflow-wrap:anywhere]">{title}</p>
                <p className="mt-0.5 text-sm text-muted">{body}</p>
                <p className="mt-1 text-xs text-subtle">{t(approval ? 'ops.inbox.kind.decision' : 'ops.inbox.kind.problem')} · {waiting}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {approval && <ApproveUpdatesButton alertId={a.id} count={Number((a.params as { count?: number } | null)?.count ?? 1)} />}
                {runId && <Link href={`/sites/${a.site_id}/runs/${runId}`} className="btn btn-primary px-3 py-1.5 text-xs">{t('ops.inbox.viewRun')}</Link>}
                <form action={acknowledgeAlert}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="btn btn-ghost px-3 py-1.5 text-xs">{t('alerts.acknowledge')}</button>
                </form>
              </div>
            </li>
          )
        }
        const vars = { component: item.component, version: item.target ?? '', count: item.vulnCount }
        const title = { approve: 'ops.inbox.approveTitle', manual: 'ops.inbox.manualTitle', no_fix: 'ops.inbox.noFixTitle', blocked_fix: 'ops.inbox.blockedTitle' }[item.kind]
        const body = { approve: 'ops.inbox.approveBody', manual: 'ops.inbox.manualBody', no_fix: 'ops.inbox.noFixBody', blocked_fix: 'ops.inbox.blockedBody' }[item.kind]
        const blockedRun = item.kind === 'blocked_fix' ? item.sites.find(s => s.runId) : undefined
        return (
          <li key={item.key} className="flex flex-wrap items-start gap-3 px-5 py-4">
            <Severity t={t} severity={item.severity} />
            <div className="min-w-0 flex-1 basis-64">
              <SiteNames sites={item.sites} t={t} />
              <p className="mt-0.5 text-sm font-semibold [overflow-wrap:anywhere]">{t(title as MessageKey, vars)}</p>
              <p className="mt-0.5 text-sm text-muted [overflow-wrap:anywhere]">{t(body as MessageKey, vars)}</p>
              <p className="mt-1 text-xs text-subtle">
                {t(item.kind === 'approve' ? 'ops.inbox.kind.decision' : 'ops.inbox.kind.problem')} · {waiting}
                {' · '}<Link href={`/security#v-${item.vulnIds[0]}`} className="hover:text-text">{t('ops.inbox.details')}</Link>
              </p>
            </div>
            {item.kind === 'approve' && <FixButton component={{ type: item.componentType, slug: item.componentSlug }} siteIds={item.sites.map(s => s.siteId)} />}
            {blockedRun && (
              <Link href={`/sites/${blockedRun.siteId}/runs/${blockedRun.runId}`} className="btn btn-ghost px-3 py-1.5 text-xs">{t('ops.inbox.viewDiagnosis')}</Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** De website(s) waar het om gaat: altijd bovenaan, als link. */
export function SiteNames({ sites, t, max = 3 }: { sites: Array<{ siteId: string; siteName: string }>; t: Translate; max?: number }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-bold text-text">
      <Globe size={13} className="shrink-0 text-subtle" aria-hidden />
      {sites.slice(0, max).map((s, n) => (
        <span key={s.siteId}>
          <Link href={`/sites/${s.siteId}`} className="hover:text-accent">{s.siteName}</Link>{n < Math.min(sites.length, max) - 1 ? ',' : ''}
        </span>
      ))}
      {sites.length > max && <span className="font-normal text-muted">{t('ops.inbox.moreSites', { count: sites.length - max })}</span>}
    </p>
  )
}

/** Lopende updates met stap en voortgang. */
export function ActiveRuns({ runs, t }: { runs: ActiveRun[]; t: Translate }) {
  return (
    <ul className="divide-y divide-border/60">
      {runs.map(r => {
        const pct = Math.round(runProgress(r.status) * 100)
        const what = r.items.map(i => `${i.name} ${i.from_version ?? ''} → ${i.to_version ?? ''}`).join(', ')
        return (
          <li key={r.id} className="px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="min-w-0 text-sm font-semibold">
                <Link href={`/sites/${r.siteId}/runs/${r.id}`} className="hover:text-accent">{r.siteName}</Link>
                {r.trigger === 'security' && <span className="badge badge-warn ml-2 align-middle">{t('ops.running.security')}</span>}
                {r.trigger === 'scheduled' && <span className="badge badge-muted ml-2 align-middle">{t('ops.running.scheduled')}</span>}
              </p>
              <span className="text-xs text-muted">{r.status === 'queued' ? t('ops.running.queued') : t(`runs.steps.${r.status}` as MessageKey)}</span>
            </div>
            <p className="mt-0.5 font-mono text-xs text-subtle [overflow-wrap:anywhere]">{what}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
              aria-label={t('ops.running.progress', { site: r.siteName })}>
              <div className={cn('h-full rounded-full', r.status === 'queued' ? 'bg-subtle' : 'bg-accent')} style={{ width: `${Math.max(pct, 3)}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Eén kwetsbaarheid over alle sites, met status per site en blootstelling. */
export function VulnGroupCard({ g, t, now, compact = false }: { g: VulnGroup; t: Translate; now: number; compact?: boolean }) {
  const awaiting = uniqueSites(g.sites.filter(s => s.state === 'awaiting' || s.state === 'fixable'))
  const states = (Object.entries(g.counts) as Array<[SiteState, number]>).filter(([, n]) => n > 0)
  return (
    <article id={`v-${g.id}`} className="scroll-mt-6 space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          {compact && <div className="mb-1"><SiteNames sites={uniqueSites(g.sites)} t={t} /></div>}
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Severity t={t} severity={g.severity} />
            <span className="[overflow-wrap:anywhere]">{g.component}</span>
          </p>
          {g.url ? (
            <a href={g.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-sm text-muted hover:text-accent [overflow-wrap:anywhere]">
              {g.title} <ExternalLink size={11} className="inline" aria-hidden />
            </a>
          ) : <p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">{g.title}</p>}
          <p className="mt-1 font-mono text-xs text-subtle">
            {[g.cve, g.cvss !== null ? `CVSS ${g.cvss.toFixed(1)}` : null, t('ops.security.affected', { count: g.siteCount }), t('ops.security.exposure', { time: formatDuration(now - Date.parse(g.firstSeen), t) })].filter(Boolean).join(' · ')}
          </p>
        </div>
        {!compact && awaiting.length > 0 && <FixButton vulnerabilityId={g.id} siteIds={awaiting.map(s => s.siteId)} variant="ghost" />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {states.map(([state, n]) => <span key={state} className={cn('badge', STATE_CLASS[state])}>{t(`ops.state.${state}` as MessageKey)} · {n}</span>)}
      </div>
      {!compact && (
        <ul className="space-y-1 text-sm">
          {g.sites.map(s => (
            <li key={`${s.siteId}:${s.slug}`} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="min-w-0 [overflow-wrap:anywhere]"><Link href={`/sites/${s.siteId}`} className="font-medium hover:text-accent">{s.siteName}</Link> <span className="text-subtle">· {s.component}</span></span>
              <span className="font-mono text-xs text-subtle">
                {s.installed}{s.target ? ` → ${s.target}` : ''} · {t(`ops.state.${s.state}` as MessageKey)}
                {s.runId && (s.state === 'blocked' || s.state === 'fixing') && <> · <Link href={`/sites/${s.siteId}/runs/${s.runId}`} className="hover:text-text">{t('runs.panel.view')}</Link></>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

/** Tijdlijn van de afgelopen 24 uur. */
export function Activity({ entries, t, locale }: { entries: ActivityEntry[]; t: Translate; locale: Locale }) {
  return (
    <ul className="divide-y divide-border/60">
      {entries.map((e, i) => {
        let text: string
        let badge: { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' | 'active' } | null = null
        let href = `/sites/${e.siteId}`
        if (e.kind === 'run') {
          const items = e.items.join(', ')
          const key = { deployed: 'runDeployed', blocked: 'runBlocked', rolled_back: 'runRolledBack', cancelled: 'runCancelled' }[e.verdict] ?? 'runError'
          text = t(`ops.activity.${key}` as MessageKey, { items })
          if (e.verdict === 'deployed' && e.attention.length) text += ` · ${t('ops.activity.runAttention', { items: e.attention.join(', ') })}`
          badge = runBadge(t, { status: 'done', verdict: e.verdict, reason_key: e.reasonKey })
          href = `/sites/${e.siteId}/runs/${e.runId}`
        } else {
          const { title } = presentAlert(t, locale, e.alert)
          text = t(e.kind === 'alert_opened' ? 'ops.activity.alertOpened' : 'ops.activity.alertResolved', { title })
        }
        return (
          <li key={`${e.kind}:${i}`} className="flex items-start gap-3 px-5 py-3 text-sm">
            <span className="w-11 shrink-0 font-mono text-xs text-subtle tabular-nums">{formatTime(e.at, locale)}</span>
            <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <Link href={href} className="font-semibold hover:text-accent">{e.siteName}</Link>
              <span className="text-subtle"> · </span>{text}
              {e.kind === 'run' && e.trigger === 'security' && <span className="text-subtle"> ({t('ops.activity.auto')})</span>}
              {e.kind === 'run' && e.trigger === 'scheduled' && <span className="text-subtle"> ({t('ops.activity.scheduled')})</span>}
            </p>
            {badge && <RunBadge {...badge} />}
          </li>
        )
      })}
    </ul>
  )
}
