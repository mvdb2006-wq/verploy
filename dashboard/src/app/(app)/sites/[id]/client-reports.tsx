'use client'
import { useActionState } from 'react'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { LOCALES } from '@/lib/i18n/core'
import { saveClientSettings } from './actions'

export function ClientReports({ siteId, clientName, clientEmail, reportLocale, monthly, canEdit }: {
  siteId: string; clientName: string | null; clientEmail: string | null; reportLocale: string; monthly: boolean; canEdit: boolean
}) {
  const { t } = useI18n()
  const [state, action] = useActionState(saveClientSettings, {})
  return (
    <details className="group rounded-(--radius-card) border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 marker:hidden">
        <span className="font-bold"><span className="mr-2 inline-block text-muted transition-transform group-open:rotate-90" aria-hidden>›</span>{t('reports.site.title')}</span>
        <Link href={`/reports?site=${siteId}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
          <FileText size={14} aria-hidden /> {t('reports.site.makeReport')}
        </Link>
      </summary>
      <form action={action} className="space-y-4 border-t border-border px-5 py-5">
        <input type="hidden" name="site_id" value={siteId} />
        <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="client_name" className="label">{t('reports.site.clientName')}</label>
            <input id="client_name" name="client_name" className="input" defaultValue={clientName ?? ''} maxLength={120} />
          </div>
          <div>
            <label htmlFor="client_email" className="label">{t('reports.site.clientEmail')}</label>
            <input id="client_email" name="client_email" type="email" className="input" defaultValue={clientEmail ?? ''} />
          </div>
          <div>
            <label htmlFor="report_locale" className="label">{t('reports.site.reportLocale')}</label>
            <select id="report_locale" name="report_locale" className="input" defaultValue={reportLocale}>
              {LOCALES.map(l => <option key={l} value={l}>{t(`common.locales.${l}`)}</option>)}
            </select>
          </div>
          <div className="self-end">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="report_monthly" defaultChecked={monthly} className="mt-0.5 size-4 accent-(--color-accent)" />
              <span>{t('reports.site.monthly')}<span className="block text-xs text-subtle">{t('reports.site.monthlyHelp')}</span></span>
            </label>
          </div>
        </fieldset>
        {canEdit && (
          <div className="flex items-center gap-3">
            <SubmitButton variant="ghost">{t('common.save')}</SubmitButton>
            {state.saved && <span className="text-sm text-accent" role="status">{t('common.saved')}</span>}
          </div>
        )}
        {state.error && <Alert>{state.error}</Alert>}
      </form>
    </details>
  )
}
