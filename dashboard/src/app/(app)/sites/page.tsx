import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { agencyIsWritable, canManage, requireAgency, trialDaysLeft } from '@/lib/session'
import { daysAgoIso, effectiveStatus, formatRelative, requestNow } from '@/lib/format'
import { SITE_FILTERS, buildSiteRows, type SiteFilter } from '@/lib/sites/list'
import { SitesTable } from './SitesTable'

export async function generateMetadata() {
  return { title: (await getT())('dashboard.title') }
}

/** Alle sites, compact: status, uptime (30 dagen), updates, lekken en de laatste update. Zoeken en filteren in de browser. */
export default async function SitesPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const session = await requireAgency()
  const [t, locale, supabase, sp] = await Promise.all([getT(), getLocale(), createClient(), searchParams])
  const now = requestNow()
  const since30 = daysAgoIso(30, now)
  const [{ data: sites }, { data: updates }, { data: alerts }, { data: vulns }, { data: active }, { data: lastRuns }, { data: offline }] = await Promise.all([
    supabase.from('sites').select('id, name, url, client_name, status, connection_status, last_heartbeat_at, paired_at').order('name'),
    supabase.from('site_components').select('site_id').eq('update_available', true),
    supabase.from('alerts').select('site_id, severity').eq('status', 'open').in('severity', ['warning', 'critical']),
    supabase.from('site_vulnerabilities').select('site_id, severity').eq('status', 'open'),
    supabase.from('update_runs').select('site_id').neq('status', 'done'),
    supabase.from('update_runs').select('id, site_id, verdict, reason_key, finished_at').eq('status', 'done').gte('finished_at', daysAgoIso(90, now))
      .order('finished_at', { ascending: false }).limit(2000),
    supabase.from('alerts').select('site_id, opened_at, resolved_at, params').eq('type', 'site_offline').or(`resolved_at.is.null,resolved_at.gte.${since30}`),
  ])
  const list = (sites ?? []).map(s => ({ ...s, effective: effectiveStatus(s, now) }))
  const rows = buildSiteRows(list, {
    updates: updates ?? [], alerts: alerts ?? [], vulns: vulns ?? [],
    activeRunSites: new Set((active ?? []).map(r => r.site_id)), lastRuns: lastRuns ?? [],
    offline: (offline ?? []).map(a => ({ site_id: a.site_id, opened_at: a.opened_at, resolved_at: a.resolved_at, since: (a.params as { since?: string } | null)?.since ?? null })),
  }, now).map(r => ({ ...r, lastRunAgo: r.lastRun ? formatRelative(r.lastRun.at, locale, now) : null }))

  const online = list.filter(s => s.effective === 'online').length
  const writable = agencyIsWritable(session.agency)
  const trialDays = trialDaysLeft(session.agency)
  const initialFilter = (SITE_FILTERS as string[]).includes(sp.f ?? '') ? (sp.f as SiteFilter) : 'all'

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('dashboard.summary', { count: list.length, online })}</p>
        </div>
        {canManage(session.role) && writable && (
          <Link href="/sites/new" className="btn btn-primary"><Plus size={16} aria-hidden /> {t('dashboard.addSite')}</Link>
        )}
      </header>

      {!writable && <Alert tone="warn" className="mb-6">{t('dashboard.readOnlyBanner')}</Alert>}
      {writable && trialDays !== null && <Alert tone="info" className="mb-6">{t('dashboard.trialBanner', { days: trialDays })}</Alert>}

      {list.length === 0 ? (
        <section className="card flex flex-col items-center px-6 py-16 text-center">
          <h2 className="text-lg font-bold">{t('dashboard.emptyTitle')}</h2>
          <p className="mt-2 max-w-sm text-sm text-muted">{t('dashboard.emptyBody')}</p>
          {canManage(session.role) && writable && (
            <Link href="/sites/new" className="btn btn-primary mt-6"><Plus size={16} aria-hidden /> {t('dashboard.addSite')}</Link>
          )}
        </section>
      ) : (
        <SitesTable rows={rows} initialFilter={initialFilter} initialQuery={sp.q ?? ''} />
      )}
    </div>
  )
}
