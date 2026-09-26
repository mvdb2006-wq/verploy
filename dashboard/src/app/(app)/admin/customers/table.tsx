'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useI18n } from '@/lib/i18n/client'
import type { MessageKey } from '@/lib/i18n/core'
import { DATE_LOCALE_TAG } from '@/lib/i18n/core'
import { formatDate } from '@/lib/format'
import { statusText, type Customer, type CustomerStatus } from '@/lib/admin/customers'
import { cn } from '@/lib/cn'

const STATUSES: CustomerStatus[] = ['late', 'trial', 'active', 'cancels', 'trial_ended', 'stopped', 'free']
const STATUS_CLASS: Record<CustomerStatus, string> = {
  late: 'badge-danger', trial: 'badge-muted', trial_ended: 'badge-warn', active: 'badge-ok', cancels: 'badge-warn', stopped: 'badge-muted', free: 'badge-ok',
}
type Sort = 'since' | 'mrr' | 'next' | 'status'

/** Klantentabel met zoeken, filteren en sorteren in de browser. Rijen met een probleem vallen op. */
export function CustomersTable({ customers }: { customers: Customer[] }) {
  const { t, locale } = useI18n()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<CustomerStatus | ''>('')
  const [plan, setPlan] = useState('')
  const [sort, setSort] = useState<Sort>('since')
  const plans = useMemo(() => [...new Map(customers.map(c => [c.plan_id, c.plan_name])).entries()], [customers])
  const money = (cents: number) => new Intl.NumberFormat(DATE_LOCALE_TAG[locale], { style: 'currency', currency: 'EUR' }).format(cents / 100)

  const q = query.trim().toLowerCase()
  const shown = customers
    .filter(c => (!status || c.status === status) && (!plan || c.plan_id === plan)
      && (!q || c.name.toLowerCase().includes(q) || (c.owner_email ?? '').toLowerCase().includes(q)))
    .sort((a, b) => sort === 'mrr' ? b.mrrCents - a.mrrCents
      : sort === 'next' ? (a.paying && a.period_end ? a.period_end : '9').localeCompare(b.paying && b.period_end ? b.period_end : '9')
      : sort === 'status' ? STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)
      : b.created_at.localeCompare(a.created_at))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">{t('admin.search')}</span>
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" aria-hidden />
          <input id="customer-search" className="input pl-9" type="search" placeholder={t('admin.search')} value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        <select id="customer-status" className="input w-auto" aria-label={t('admin.col.status')} value={status} onChange={e => setStatus(e.target.value as CustomerStatus | '')}>
          <option value="">{t('admin.filterAll')}</option>
          {STATUSES.map(s => <option key={s} value={s}>{s === 'trial' ? t('admin.kpi.trials') : t(`admin.status.${s}` as MessageKey)}</option>)}
        </select>
        <select id="customer-plan" className="input w-auto" aria-label={t('admin.col.plan')} value={plan} onChange={e => setPlan(e.target.value)}>
          <option value="">{t('admin.planAll')}</option>
          {plans.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select id="customer-sort" className="input w-auto" aria-label={t('admin.sort')} value={sort} onChange={e => setSort(e.target.value as Sort)}>
          {(['since', 'mrr', 'next', 'status'] as const).map(s => <option key={s} value={s}>{t(`admin.sortBy.${s}`)}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-(--radius-card) border border-border bg-surface">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              {(['agency', 'plan', 'status', 'payment', 'next', 'sites', 'since', 'mrr'] as const).map(col => (
                <th key={col} scope="col" className={cn('px-4 py-3 font-semibold', col === 'mrr' && 'text-right')}>{t(`admin.col.${col}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {shown.map(c => {
              const inv = c.stripe?.lastInvoice
              return (
                <tr key={c.id} className={cn('align-top', c.status === 'late' && 'bg-danger/5', c.status === 'trial_ended' && 'bg-warn/5')}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/customers/${c.id}`} className="font-semibold hover:text-accent">{c.name}</Link>
                    <p className="text-xs text-muted">{c.owner_email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {c.plan_name}
                    {c.stripe?.percentOff ? <p className="text-xs text-accent">{t('admin.discount', { name: c.stripe.couponName ?? '', percent: c.stripe.percentOff })}</p> : null}
                  </td>
                  <td className="px-4 py-3"><span className={cn('badge', STATUS_CLASS[c.status])}>{statusText(t, locale, c)}</span></td>
                  <td className="px-4 py-3 text-xs">
                    {inv ? (
                      <>
                        <span className={cn('badge', inv.status === 'paid' ? 'badge-ok' : inv.status === 'open' || inv.status === 'uncollectible' ? 'badge-danger' : 'badge-muted')}>
                          {t(`admin.invoice.${inv.status}` as MessageKey)}
                        </span>
                        <p className="mt-1 text-muted">{money(inv.amountCents)} · {formatDate(inv.date, locale)}</p>
                        {inv.status !== 'paid' && inv.nextAttempt && <p className="text-muted">{t('admin.retry', { attempts: inv.attempts, date: formatDate(inv.nextAttempt, locale) })}</p>}
                      </>
                    ) : <span className="text-subtle">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.paying && c.status !== 'cancels' && c.period_end ? <>{formatDate(c.period_end, locale)}<p className="text-muted">{money(c.mrrCents)}</p></> : <span className="text-subtle">—</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{c.sites_connected}/{c.sites_limit}</td>
                  <td className="px-4 py-3 text-xs">{formatDate(c.created_at, locale)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{c.mrrCents ? money(c.mrrCents) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">{t('admin.none')}</p>}
      </div>
    </div>
  )
}
