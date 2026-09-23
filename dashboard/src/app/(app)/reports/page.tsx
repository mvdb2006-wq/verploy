import { Download } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { canManage, requireAgency } from '@/lib/session'
import { formatDate } from '@/lib/format'
import type { MessageKey } from '@/lib/i18n/core'
import { RunBadge } from '@/components/RunBadge'
import { AutoRefresh } from '@/components/AutoRefresh'
import { ReportForm } from './form'

export async function generateMetadata() {
  return { title: (await getT())('reports.title') }
}

const TONE = { queued: 'active', generating: 'active', ready: 'ok', sent: 'ok', failed: 'danger' } as const

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const session = await requireAgency()
  const { site: siteParam } = await searchParams
  const [t, locale, supabase] = await Promise.all([getT(), getLocale(), createClient()])
  const [{ data: sites }, { data: reports }] = await Promise.all([
    supabase.from('sites').select('id, name, client_email').order('name'),
    supabase.from('reports').select('id, site_id, trigger, period_start, period_end, locale, status, send_to, created_at, pdf_path')
      .order('created_at', { ascending: false }).limit(100),
  ])
  const siteName = new Map((sites ?? []).map(s => [s.id, s.name]))
  const busy = (reports ?? []).some(r => r.status === 'queued' || r.status === 'generating')
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {busy && <AutoRefresh seconds={3} />}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('reports.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('reports.intro')}</p>
      </div>
      {(sites ?? []).length > 0 && (
        <ReportForm sites={sites ?? []} canSend={canManage(session.role)} defaultSite={siteParam && siteName.has(siteParam) ? siteParam : null} />
      )}
      <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="list-title">
        <h2 id="list-title" className="sr-only">{t('reports.title')}</h2>
        {(reports ?? []).length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">{t('reports.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-3 font-semibold">{t('reports.table.site')}</th>
                  <th className="px-3 py-3 font-semibold">{t('reports.table.period')}</th>
                  <th className="px-3 py-3 font-semibold">{t('reports.table.language')}</th>
                  <th className="px-3 py-3 font-semibold">{t('reports.table.trigger')}</th>
                  <th className="px-3 py-3 font-semibold">{t('reports.table.status')}</th>
                  <th className="px-5 py-3"><span className="sr-only">{t('reports.download')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {(reports ?? []).map(r => (
                  <tr key={r.id}>
                    <td className="px-5 py-3 font-medium">{siteName.get(r.site_id) ?? '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">{formatDate(`${r.period_start}T12:00:00Z`, locale)} – {formatDate(`${r.period_end}T12:00:00Z`, locale)}</td>
                    <td className="px-3 py-3 uppercase">{r.locale}</td>
                    <td className="px-3 py-3">{t(`reports.trigger.${r.trigger}` as MessageKey)}</td>
                    <td className="px-3 py-3"><RunBadge tone={TONE[r.status as keyof typeof TONE] ?? 'muted'} label={t(`reports.status.${r.status}` as MessageKey, { email: r.send_to ?? '' })} /></td>
                    <td className="px-5 py-3 text-right">
                      {r.pdf_path && (
                        <a href={`/report-files/${r.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
                          <Download size={14} aria-hidden /> {t('reports.download')}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
