import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { getLocale, getT } from '@/lib/i18n/server'
import { DATE_LOCALE_TAG, type MessageKey } from '@/lib/i18n/core'
import { formatDate } from '@/lib/format'
import { loadCustomers, requirePlatformAdmin } from '@/lib/admin/load'
import { statusText } from '@/lib/admin/customers'

export const dynamic = 'force-dynamic'

interface Detail {
  members: { email: string; role: string; joined_at: string; last_sign_in_at: string | null; confirmed: boolean }[]
  sites: { name: string; url: string; connection_status: string; status: string; last_heartbeat_at: string | null; connector_version: string | null }[]
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await requirePlatformAdmin()
  const [t, locale, { customers }, { data: detail }] = await Promise.all([getT(), getLocale(), loadCustomers(), supabase.rpc('admin_customer', { p_agency: id })])
  const c = customers.find(x => x.id === id)
  if (!c) notFound()
  const d = (detail ?? { members: [], sites: [] }) as unknown as Detail
  const money = (cents: number) => new Intl.NumberFormat(DATE_LOCALE_TAG[locale], { style: 'currency', currency: 'EUR' }).format(cents / 100)
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex flex-wrap justify-between gap-2 py-1.5 text-sm"><dt className="text-muted">{label}</dt><dd className="text-right">{value}</dd></div>
  )
  const inv = c.stripe?.lastInvoice

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/admin/customers" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"><ArrowLeft size={14} aria-hidden /> {t('admin.detail.back')}</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">{c.name}</h1>
        {c.stripe_customer_id && (
          <a className="btn btn-ghost" href={`https://dashboard.stripe.com/customers/${c.stripe_customer_id}`} target="_blank" rel="noopener noreferrer">
            {t('admin.detail.openStripe')} <ExternalLink size={14} aria-hidden />
          </a>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card" aria-labelledby="acc">
          <h2 id="acc" className="mb-2 font-bold">{t('admin.detail.account')}</h2>
          <dl className="divide-y divide-border/60">
            {row(t('admin.detail.owner'), c.owner_email ?? '—')}
            {row(t('admin.detail.created'), formatDate(c.created_at, locale, true))}
            {row(t('admin.detail.lastSignIn'), c.last_sign_in_at ? formatDate(c.last_sign_in_at, locale, true) : t('admin.detail.never'))}
            {row(t('admin.detail.locale'), c.locale.toUpperCase())}
          </dl>
        </section>
        <section className="card" aria-labelledby="bill">
          <h2 id="bill" className="mb-2 font-bold">{t('admin.detail.billing')}</h2>
          <dl className="divide-y divide-border/60">
            {row(t('admin.col.plan'), <>{c.plan_name} · {money(c.price_cents)}</>)}
            {row(t('admin.col.status'), statusText(t, locale, c))}
            {c.stripe?.percentOff ? row(t('admin.col.mrr'), <>{money(c.mrrCents)} <span className="text-xs text-accent">({t('admin.discount', { name: c.stripe.couponName ?? '', percent: c.stripe.percentOff })})</span></>) : row(t('admin.col.mrr'), c.mrrCents ? money(c.mrrCents) : '—')}
            {c.period_end && c.paying && row(t('admin.col.next'), t('admin.detail.period', { date: formatDate(c.period_end, locale) }))}
            {row(t('admin.col.payment'), inv ? <>{t(`admin.invoice.${inv.status}` as MessageKey)} · {money(inv.amountCents)} · {formatDate(inv.date, locale)}{inv.url && <> · <a className="text-accent hover:underline" href={inv.url} target="_blank" rel="noopener noreferrer">{t('admin.detail.openInvoice')}</a></>}</> : '—')}
          </dl>
          {!c.stripe_customer_id && <p className="mt-2 text-xs text-muted">{t('admin.detail.noStripe')}</p>}
        </section>
      </div>

      <section className="card" aria-labelledby="mem">
        <h2 id="mem" className="mb-2 font-bold">{t('admin.detail.members')}</h2>
        <ul className="divide-y divide-border/60 text-sm">
          {d.members.map(m => (
            <li key={m.email} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">{m.email} {!m.confirmed && <span className="badge badge-warn">{t('admin.loose.unconfirmed')}</span>}</span>
              <span className="text-xs text-muted">{t(`team.role.${m.role}` as MessageKey)} · {t('admin.detail.lastSignIn')}: {m.last_sign_in_at ? formatDate(m.last_sign_in_at, locale) : t('admin.detail.never')}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="st">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="st" className="font-bold">{t('admin.detail.sites')}</h2>
          <span className="text-xs text-muted">{t('admin.detail.usage', { used: c.sites_connected, limit: c.sites_limit })}</span>
        </div>
        {d.sites.length === 0 ? <p className="text-sm text-muted">{t('admin.detail.noSites')}</p> : (
          <ul className="divide-y divide-border/60 text-sm">
            {d.sites.map(s => (
              <li key={s.url} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium">{s.name}</span> <span className="text-xs text-muted">{s.url}</span></span>
                <span className="text-xs text-muted">{s.connection_status}{s.connector_version ? ` · ${s.connector_version}` : ''}{s.last_heartbeat_at ? ` · ${formatDate(s.last_heartbeat_at, locale, true)}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
