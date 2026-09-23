'use client'
import { useActionState, useState } from 'react'
import { Alert } from '@/components/Alert'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { createReport } from './actions'

export function ReportForm({ sites, canSend, defaultSite }: {
  sites: { id: string; name: string; client_email: string | null }[]
  canSend: boolean
  defaultSite: string | null
}) {
  const { t } = useI18n()
  const [state, action] = useActionState(createReport, {})
  const [period, setPeriod] = useState('lastMonth')
  const [siteId, setSiteId] = useState(defaultSite ?? sites[0]?.id ?? '')
  const email = sites.find(s => s.id === siteId)?.client_email ?? null
  return (
    <form action={action} className="card space-y-4" aria-labelledby="create-title">
      <h2 id="create-title" className="text-lg font-bold">{t('reports.create.title')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="site_id" className="label">{t('reports.create.site')}</label>
          <select id="site_id" name="site_id" className="input" value={siteId} onChange={e => setSiteId(e.target.value)}>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <fieldset>
          <legend className="label">{t('reports.create.period')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1 text-sm">
            {(['lastMonth', 'thisMonth', 'custom'] as const).map(p => (
              <label key={p} className="flex items-center gap-2">
                <input type="radio" name="period" value={p} checked={period === p} onChange={() => setPeriod(p)} className="accent-(--color-accent)" />
                {t(`reports.create.${p}`)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {period === 'custom' && (
        <div className="grid max-w-md grid-cols-2 gap-4">
          <div><label htmlFor="from" className="label">{t('reports.create.from')}</label><input id="from" name="from" type="date" className="input" required /></div>
          <div><label htmlFor="to" className="label">{t('reports.create.to')}</label><input id="to" name="to" type="date" className="input" required /></div>
        </div>
      )}
      {canSend && (
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="send" disabled={!email} className="size-4 accent-(--color-accent)" />
            {t('reports.create.send')}{email ? ` (${email})` : ''}
          </label>
          <p className="mt-1 text-xs text-subtle">{email ? t('reports.create.sendHint') : t('reports.errors.no_client_email')}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{t('reports.create.submit')}</SubmitButton>
        {state.ok && <span className="text-sm text-accent" role="status">{state.ok}</span>}
      </div>
      {state.error && <Alert>{state.error}</Alert>}
    </form>
  )
}
