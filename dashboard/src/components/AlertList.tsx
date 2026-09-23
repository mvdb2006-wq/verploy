import Link from 'next/link'
import { SeverityBadge } from '@/components/SeverityBadge'
import { formatDate } from '@/lib/format'
import { presentAlert } from '@/lib/monitoring/present'
import type { Locale, MessageKey, Translate } from '@/lib/i18n/core'
import { acknowledgeAlert } from '@/app/(app)/alerts/actions'

export interface AlertRow {
  id: string
  type: string
  severity: string
  status: string
  params: unknown
  opened_at: string
  resolved_at: string | null
  acknowledged_at: string | null
  site?: { id: string; name: string } | null
}

export function AlertList({ alerts, t, locale, showSite = true }: { alerts: AlertRow[]; t: Translate; locale: Locale; showSite?: boolean }) {
  return (
    <ul className="divide-y divide-border/60">
      {alerts.map(a => {
        const { title, body } = presentAlert(t, locale, a)
        return (
          <li key={a.id} className={`flex flex-wrap items-start gap-3 px-5 py-4 ${a.acknowledged_at && a.status === 'open' ? 'opacity-70' : ''}`}>
            <SeverityBadge severity={a.severity} label={t(`alerts.severity.${a.severity}` as MessageKey)} />
            <div className="min-w-0 flex-1 basis-64">
              <p className="text-sm font-semibold">
                {showSite && a.site && <><Link href={`/sites/${a.site.id}`} className="hover:text-accent">{a.site.name}</Link><span className="text-subtle"> · </span></>}
                {title}
              </p>
              <p className="mt-0.5 text-sm text-muted">{body}</p>
              <p className="mt-1 text-xs text-subtle">
                {a.status === 'open'
                  ? t('alerts.since', { date: formatDate(a.opened_at, locale, true) })
                  : t('alerts.resolvedAt', { date: formatDate(a.resolved_at, locale, true) })}
              </p>
            </div>
            {a.status === 'open' && (a.acknowledged_at
              ? <span className="text-xs text-subtle">{t('alerts.acknowledged')}</span>
              : (
                <form action={acknowledgeAlert}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="btn btn-ghost px-3 py-1.5 text-xs">{t('alerts.acknowledge')}</button>
                </form>
              ))}
          </li>
        )
      })}
    </ul>
  )
}
