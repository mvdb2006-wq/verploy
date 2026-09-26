import { getLocale, getT } from '@/lib/i18n/server'
import { formatDate } from '@/lib/format'
import { DATE_LOCALE_TAG } from '@/lib/i18n/core'
import { Alert } from '@/components/Alert'
import { kpis } from '@/lib/admin/customers'
import { loadCustomers, requirePlatformAdmin } from '@/lib/admin/load'
import { CustomersTable } from './table'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return { title: (await getT())('admin.title') }
}

/** Klantoverzicht voor de beheerder van Verploy (zie marketing-site/APP-HANDOFF-customer-overview.md). */
export default async function CustomersPage() {
  const supabase = await requirePlatformAdmin()
  const [t, locale, { customers, stripeOk, fetchedAt }, { data: loose }] = await Promise.all([
    getT(), getLocale(), loadCustomers(), supabase.rpc('admin_loose_users'),
  ])
  const k = kpis(customers, (loose ?? []).length)
  const money = (cents: number) => new Intl.NumberFormat(DATE_LOCALE_TAG[locale], { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)
  const tiles: { label: string; value: string; sub?: string; tone?: 'danger' }[] = [
    { label: t('admin.kpi.paying'), value: String(k.paying) },
    { label: t('admin.kpi.trials'), value: String(k.trials), sub: t('admin.kpi.trialsEnding', { count: k.trialsEndingThisWeek }) },
    { label: t('admin.kpi.late'), value: String(k.late), tone: k.late ? 'danger' : undefined },
    { label: t('admin.kpi.mrr'), value: money(k.mrrCents) },
    { label: t('admin.kpi.stopped'), value: String(k.stoppedThisMonth) },
    { label: t('admin.kpi.noAgency'), value: String(k.noAgency) },
  ]
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t('admin.title')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">{t('admin.intro')}</p>
        </div>
        <a href="/admin/customers/export" className="btn btn-ghost" download>{t('admin.export')}</a>
      </div>
      {stripeOk
        ? <p className="text-xs text-subtle">{t('admin.updated', { time: formatDate(fetchedAt, locale, true) })}</p>
        : <Alert tone="warn">{t('admin.stripeUnavailable')}</Alert>}

      <section aria-label={t('admin.title')} className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {tiles.map(tile => (
          <div key={tile.label} className="rounded-(--radius-card) border border-border bg-surface px-4 py-3">
            <p className="text-xs text-muted">{tile.label}</p>
            <p className={`mt-1 text-2xl font-extrabold tabular-nums ${tile.tone === 'danger' ? 'text-danger' : ''}`}>{tile.value}</p>
            {tile.sub && <p className="mt-0.5 text-[11px] text-subtle">{tile.sub}</p>}
          </div>
        ))}
      </section>

      <CustomersTable customers={customers} />

      <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="loose-title">
        <div className="border-b border-border px-5 py-4">
          <h2 id="loose-title" className="font-bold">{t('admin.loose.title')}</h2>
          <p className="mt-0.5 text-sm text-muted">{t('admin.loose.intro')}</p>
        </div>
        {(loose ?? []).length === 0
          ? <p className="px-5 py-4 text-sm text-muted">{t('admin.loose.none')}</p>
          : (
            <ul className="divide-y divide-border/60">
              {(loose ?? []).map(u => (
                <li key={u.user_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 truncate font-medium">{u.email}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className={`badge ${u.confirmed ? 'badge-ok' : 'badge-warn'}`}>{u.confirmed ? t('admin.loose.confirmed') : t('admin.loose.unconfirmed')}</span>
                    {u.intended_plan && <span>{t('admin.loose.plan', { plan: u.intended_plan })}</span>}
                    <span>{formatDate(u.created_at, locale, true)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}
