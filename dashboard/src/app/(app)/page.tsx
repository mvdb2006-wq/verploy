import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { StatusBadge } from '@/components/StatusBadge'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { agencyIsWritable, canManage, requireAgency, trialDaysLeft } from '@/lib/session'
import { effectiveStatus, formatRelative } from '@/lib/format'
import type { MessageKey } from '@/lib/i18n/core'

export async function generateMetadata() {
  return { title: (await getT())('dashboard.title') }
}

export default async function SitesPage() {
  const session = await requireAgency()
  const [t, locale, supabase] = await Promise.all([getT(), getLocale(), createClient()])
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, url, client_name, status, connection_status, wp_version, php_version, last_heartbeat_at')
    .order('name')
  const { data: updates } = await supabase.from('site_components').select('site_id').eq('update_available', true)
  const updateCount = new Map<string, number>()
  for (const u of updates ?? []) updateCount.set(u.site_id, (updateCount.get(u.site_id) ?? 0) + 1)

  const list = (sites ?? []).map(s => ({ ...s, effective: effectiveStatus(s) }))
  const online = list.filter(s => s.effective === 'online').length
  const writable = agencyIsWritable(session.agency)
  const trialDays = trialDaysLeft(session.agency)

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
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
        <div className="overflow-x-auto rounded-(--radius-card) border border-border bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-bold tracking-[0.1em] text-subtle uppercase">
                <th scope="col" className="px-5 py-3">{t('dashboard.colSite')}</th>
                <th scope="col" className="px-5 py-3">{t('dashboard.colStatus')}</th>
                <th scope="col" className="px-5 py-3">{t('dashboard.colWordpress')}</th>
                <th scope="col" className="px-5 py-3">{t('dashboard.colPhp')}</th>
                <th scope="col" className="px-5 py-3 text-right">{t('dashboard.colLastSeen')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map(s => {
                const updatesForSite = updateCount.get(s.id) ?? 0
                return (
                  <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-surface2/60">
                    <td className="px-5 py-3.5">
                      <Link href={`/sites/${s.id}`} className="font-semibold hover:text-accent">{s.name}</Link>
                      <p className="font-mono text-xs text-subtle">{s.url.replace(/^https?:\/\//, '')}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={s.effective} label={t(`site.status.${s.effective}` as MessageKey)} />
                      {updatesForSite > 0 && (
                        <span className="badge badge-warn ml-2">{t('siteDetail.updatesAvailable', { count: updatesForSite })}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-mono tabular-nums">{s.wp_version ?? '—'}</td>
                    <td className="px-5 py-3.5 font-mono tabular-nums">{s.php_version ?? '—'}</td>
                    <td className="px-5 py-3.5 text-right text-muted tabular-nums">{formatRelative(s.last_heartbeat_at, locale) ?? t('common.never')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
