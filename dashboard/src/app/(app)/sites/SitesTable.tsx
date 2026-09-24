'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ExternalLink, Search, ShieldAlert } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { SeverityBadge } from '@/components/SeverityBadge'
import { RunBadge } from '@/components/RunBadge'
import { useI18n } from '@/lib/i18n/client'
import type { MessageKey } from '@/lib/i18n/core'
import { runBadge } from '@/lib/runs'
import { SITE_FILTERS, matchesQuery, type SiteFilter, type SiteRow } from '@/lib/sites/list'
import { cn } from '@/lib/cn'

export type SiteRowView = SiteRow & { lastRunAgo: string | null }

const VULN_CLASS = { critical: 'badge-danger', high: 'badge-danger', medium: 'badge-warn', low: 'badge-muted' } as const

/** Sitesoverzicht met direct zoeken en de zes filters (alleen in de browser: ook bij honderden sites direct). */
export function SitesTable({ rows, initialFilter, initialQuery }: { rows: SiteRowView[]; initialFilter: SiteFilter; initialQuery: string }) {
  const { t, locale } = useI18n()
  const [filter, setFilter] = useState<SiteFilter>(initialFilter)
  const [query, setQuery] = useState(initialQuery)
  const counts = useMemo(() => Object.fromEntries(SITE_FILTERS.map(f => [f, rows.filter(r => r.filters.includes(f)).length])) as Record<SiteFilter, number>, [rows])
  const shown = rows.filter(r => r.filters.includes(filter) && matchesQuery(r, query))

  // Filter en zoekterm in de adresbalk, zodat terug-navigeren en delen dezelfde weergave geven.
  const remember = (f: SiteFilter, q: string) => {
    const p = new URLSearchParams()
    if (f !== 'all') p.set('f', f)
    if (q.trim()) p.set('q', q.trim())
    window.history.replaceState(null, '', p.size ? `?${p}` : window.location.pathname)
  }
  const pct = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">{t('sitesList.search')}</span>
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" aria-hidden />
          <input id="sites-search" type="search" value={query} placeholder={t('sitesList.search')} autoComplete="off"
            onChange={e => { setQuery(e.target.value); remember(filter, e.target.value) }}
            className="input w-full pl-9" />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('sitesList.filterLabel')}>
          {SITE_FILTERS.map(f => (
            <button key={f} type="button" aria-pressed={filter === f}
              onClick={() => { setFilter(f); remember(f, query) }}
              className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                filter === f ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:text-text',
                counts[f] === 0 && filter !== f && 'opacity-50')}>
              {t(`sitesList.filter.${f}` as MessageKey)} <span className="tabular-nums">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-(--radius-card) border border-border bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-bold tracking-[0.1em] text-subtle uppercase">
              <th scope="col" className="px-5 py-3">{t('sitesList.col.site')}</th>
              <th scope="col" className="px-3 py-3">{t('sitesList.col.status')}</th>
              <th scope="col" className="px-3 py-3 text-right">{t('sitesList.col.uptime')}</th>
              <th scope="col" className="px-3 py-3 text-right">{t('sitesList.col.updates')}</th>
              <th scope="col" className="px-3 py-3">{t('sitesList.col.vulns')}</th>
              <th scope="col" className="px-3 py-3">{t('sitesList.col.activity')}</th>
              <th scope="col" className="px-5 py-3"><span className="sr-only">{t('sitesList.col.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map(s => (
              <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-surface2/60">
                <td className="px-5 py-3">
                  <Link href={`/sites/${s.id}`} className="font-semibold hover:text-accent">{s.name}</Link>
                  <p className="font-mono text-xs text-subtle">{s.domain}{s.client ? <span className="font-sans"> · {s.client}</span> : null}</p>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.updating ? <RunBadge label={t('sitesList.updating')} tone="active" />
                      : <StatusBadge status={s.status as 'online'} label={t(`site.status.${s.status}` as MessageKey)} />}
                    {s.alert && (
                      <Link href={`/sites/${s.id}`}>
                        <SeverityBadge severity={s.alert.severity} label={`${s.alert.count} · ${t(`alerts.severity.${s.alert.severity}` as MessageKey)}`} />
                      </Link>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums">
                  {s.uptime === null ? <span className="text-subtle">—</span>
                    : <span className={cn(s.uptime < 99 ? 'text-danger' : s.uptime < 99.9 ? 'text-warn' : '')}>{pct.format(s.uptime)}%</span>}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{s.updates > 0 ? <Link href={`/sites/${s.id}#updates`} className="font-semibold hover:text-accent">{s.updates}</Link> : <span className="text-subtle">0</span>}</td>
                <td className="px-3 py-3">
                  {s.vulns > 0 && s.vulnSeverity
                    ? <Link href={`/sites/${s.id}#security`} className={cn('badge', VULN_CLASS[s.vulnSeverity])}><ShieldAlert size={12} aria-hidden /> {s.vulns}</Link>
                    : <span className="text-subtle">0</span>}
                </td>
                <td className="px-3 py-3 text-xs text-muted">
                  {s.lastRun ? (
                    <Link href={`/sites/${s.id}/runs/${s.lastRun.id}`} className="inline-flex flex-wrap items-center gap-1.5 hover:text-text">
                      <RunBadge {...runBadge(t, { status: 'done', verdict: s.lastRun.verdict, reason_key: s.lastRun.reasonKey })} />
                      <span className="whitespace-nowrap">{s.lastRunAgo}</span>
                    </Link>
                  ) : '—'}
                </td>
                <td className="px-5 py-3 text-right">
                  <a href={`${s.url.replace(/\/$/, '')}/wp-admin/`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-muted hover:text-accent"
                    aria-label={t('sitesList.wpAdminFor', { site: s.name })}>
                    WP Admin <ExternalLink size={12} aria-hidden />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted">{t('sitesList.noResults')}</p>}
      </div>
    </div>
  )
}
