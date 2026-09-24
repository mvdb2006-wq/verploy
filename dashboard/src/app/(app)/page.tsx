import Link from 'next/link'
import { Activity as ActivityIcon, Inbox, Plus, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { AutoRefresh } from '@/components/AutoRefresh'
import { Checklist } from '@/components/Checklist'
import { Activity, ActiveRuns, InboxList, VulnGroupCard } from '@/components/ops/views'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { agencyIsWritable, canManage, requireAgency, trialDaysLeft } from '@/lib/session'
import { formatRelative, requestNow } from '@/lib/format'
import { formatDuration } from '@/lib/operations/model'
import { loadOperations } from '@/lib/operations/load'
import { cn } from '@/lib/cn'

export async function generateMetadata() {
  return { title: (await getT())('ops.title') }
}

/** Overzicht: wat gebeurt er nu, wat wacht op jou, wat is er gebeurd. */
export default async function OverviewPage() {
  const session = await requireAgency()
  const [t, locale, supabase] = await Promise.all([getT(), getLocale(), createClient()])
  const now = requestNow()
  const ops = await loadOperations(supabase, session.agency, now)
  const [{ count: runCount }, { count: reportCount }, { data: withClient }] = await Promise.all([
    supabase.from('update_runs').select('id', { count: 'exact', head: true }),
    supabase.from('reports').select('id', { count: 'exact', head: true }),
    supabase.from('sites').select('id').not('client_email', 'is', null).limit(1),
  ])
  const writable = agencyIsWritable(session.agency)
  const trialDays = trialDaysLeft(session.agency)
  const { health, inbox, active, groups } = ops
  const serious = groups.filter(g => g.severity === 'critical' || g.severity === 'high')
  const tone = inbox.some(i => i.severity === 'critical') || health.offline > 0 ? 'danger' : inbox.length > 0 ? 'warn' : 'ok'
  const first = ops.sites[0]
  const connected = ops.sites.find(s => s.effective !== 'pending')

  const tiles = [
    { key: 'running', label: t('ops.tiles.running'), value: String(active.length), sub: active.length ? t('ops.tiles.runningSub', { queued: active.filter(r => r.status === 'queued').length }) : t('ops.tiles.runningIdle'), href: '#running', icon: ActivityIcon, tone: active.length ? 'active' : 'muted' },
    { key: 'inbox', label: t('ops.tiles.inbox'), value: String(inbox.length), sub: inbox.length ? t('ops.tiles.inboxSub', { count: inbox.filter(i => i.kind === 'approve').length }) : t('ops.tiles.inboxEmpty'), href: '/inbox', icon: Inbox, tone: inbox.length ? 'warn' : 'ok' },
    { key: 'security', label: t('ops.tiles.security'), value: String(ops.exposure.openSerious), sub: t('ops.tiles.securitySub', { count: ops.exposure.exposedSites }), href: '/security', icon: ops.exposure.openSerious ? ShieldAlert : ShieldCheck, tone: ops.exposure.openSerious ? 'danger' : 'ok' },
    { key: 'healthy', label: t('ops.tiles.healthy'), value: `${health.healthy} / ${health.total}`, sub: t('ops.tiles.healthySub', { attention: health.attention, offline: health.offline, pending: health.pending }), href: '/sites', icon: ShieldCheck, tone: health.offline ? 'danger' : 'ok' },
  ] as const

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {active.length > 0 && <AutoRefresh seconds={8} />}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t('ops.title')}</h1>
          {health.total > 0 && (
            <p className={cn('mt-1 flex items-center gap-2 text-sm font-semibold', { 'text-accent': tone === 'ok', 'text-warn': tone === 'warn', 'text-danger': tone === 'danger' })} role="status">
              <span aria-hidden className={cn('size-2 rounded-full', { 'bg-accent': tone === 'ok', 'bg-warn': tone === 'warn', 'bg-danger': tone === 'danger' })} />
              {inbox.length === 0 && active.length === 0 && health.offline === 0
                ? t('ops.allGood', { healthy: health.healthy, total: health.total })
                : t('ops.summary', { inbox: inbox.length, active: active.length, offline: health.offline })}
            </p>
          )}
        </div>
        {canManage(session.role) && writable && (
          <Link href="/sites/new" className="btn btn-ghost"><Plus size={16} aria-hidden /> {t('dashboard.addSite')}</Link>
        )}
      </header>

      {canManage(session.role) && (
        <Checklist t={t} steps={[
          { key: 'addSite', done: ops.sites.length > 0, href: '/sites/new' },
          { key: 'connect', done: Boolean(connected), href: first ? `/sites/${first.id}` : '/sites/new' },
          { key: 'update', done: (runCount ?? 0) > 0, href: connected ? `/sites/${connected.id}` : first ? `/sites/${first.id}` : '/sites/new' },
          { key: 'report', done: (reportCount ?? 0) > 0 || (withClient ?? []).length > 0, href: first ? `/sites/${first.id}` : '/sites/new' },
        ]} />
      )}
      {!writable && <Alert tone="warn">{t('dashboard.readOnlyBanner')}</Alert>}
      {writable && trialDays !== null && <Alert tone="info">{t('dashboard.trialBanner', { days: trialDays })}</Alert>}

      {ops.sites.length === 0 ? (
        <section className="card flex flex-col items-center px-6 py-16 text-center">
          <h2 className="text-lg font-bold">{t('dashboard.emptyTitle')}</h2>
          <p className="mt-2 max-w-sm text-sm text-muted">{t('dashboard.emptyBody')}</p>
          {canManage(session.role) && writable && (
            <Link href="/sites/new" className="btn btn-primary mt-6"><Plus size={16} aria-hidden /> {t('dashboard.addSite')}</Link>
          )}
        </section>
      ) : (
        <>
          <section aria-label={t('ops.tiles.label')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map(tile => (
              <Link key={tile.key} href={tile.href} className="card group flex flex-col gap-1 p-4 transition-colors hover:border-accent/40">
                <span className="flex items-center gap-2 text-xs font-semibold text-muted">
                  <tile.icon size={14} aria-hidden className={cn({ 'text-accent': tile.tone === 'ok' || tile.tone === 'active', 'text-warn': tile.tone === 'warn', 'text-danger': tile.tone === 'danger', 'text-subtle': tile.tone === 'muted' })} />
                  {tile.label}
                </span>
                <span className="font-mono text-2xl font-bold tabular-nums">{tile.value}</span>
                <span className="text-xs text-subtle">{tile.sub}</span>
              </Link>
            ))}
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="min-w-0 space-y-6">
              <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="inbox-title">
                <header className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-4">
                  <h2 id="inbox-title" className="font-bold">{t('ops.inbox.title')}</h2>
                  {inbox.length > 5 && <Link href="/inbox" className="text-sm font-semibold text-accent hover:underline">{t('ops.inbox.all', { count: inbox.length })}</Link>}
                </header>
                {inbox.length === 0
                  ? <p className="px-5 py-6 text-sm text-muted">{t('ops.inbox.empty')}</p>
                  : <InboxList items={inbox} t={t} locale={locale} now={now} limit={5} />}
              </section>

              <section id="running" className="scroll-mt-6 rounded-(--radius-card) border border-border bg-surface" aria-labelledby="running-title">
                <h2 id="running-title" className="border-b border-border px-5 py-4 font-bold">{t('ops.running.title')}</h2>
                {active.length === 0
                  ? <p className="px-5 py-6 text-sm text-muted">{t('ops.running.empty')}</p>
                  : <ActiveRuns runs={active} t={t} />}
              </section>
            </div>

            <div className="min-w-0 space-y-6">
              <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="sec-title">
                <header className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-4">
                  <h2 id="sec-title" className="font-bold">{t('ops.security.title')}</h2>
                  <Link href="/security" className="text-sm font-semibold text-accent hover:underline">{t('ops.security.all')}</Link>
                </header>
                {!ops.feedFetchedAt && groups.length === 0 ? <p className="px-5 py-6 text-sm text-muted">{t('ops.security.notActive')}</p>
                  : serious.length === 0 ? <p className="px-5 py-6 text-sm text-muted">{t('ops.security.noSerious')}</p>
                  : <div className="divide-y divide-border/60">{serious.slice(0, 4).map(g => <VulnGroupCard key={g.id} g={g} t={t} now={now} compact />)}</div>}
                {ops.exposure.medianResolvedMs !== null && (
                  <p className="border-t border-border px-5 py-3 text-xs text-subtle">
                    {t('ops.security.medianLine', { time: formatDuration(ops.exposure.medianResolvedMs, t), count: ops.exposure.resolvedCount })}
                  </p>
                )}
              </section>

              <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="activity-title">
                <h2 id="activity-title" className="border-b border-border px-5 py-4 font-bold">{t('ops.activity.title')}</h2>
                {ops.activity.length === 0
                  ? <p className="px-5 py-6 text-sm text-muted">{t('ops.activity.empty')}</p>
                  : <Activity entries={ops.activity} t={t} locale={locale} />}
              </section>
            </div>
          </div>

          <p className="text-xs text-subtle">
            {ops.feedFetchedAt ? t('ops.system', { time: formatRelative(ops.feedFetchedAt, locale, now) ?? '' }) : t('ops.systemNever')}
          </p>
        </>
      )}
    </div>
  )
}
