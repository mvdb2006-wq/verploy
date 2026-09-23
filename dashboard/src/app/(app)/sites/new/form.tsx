'use client'
import { useActionState } from 'react'
import { Alert } from '@/components/Alert'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { LOCALES, type MessageKey } from '@/lib/i18n/core'
import { useI18n } from '@/lib/i18n/client'
import { createSite } from './actions'

export function NewSiteForm({ defaultLocale }: { defaultLocale: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(createSite, {})
  const f = state.fields ?? {}
  return (
    <form action={action} className="card space-y-5" noValidate>
      {state.error && <Alert>{state.error}</Alert>}
      <Field id="url" label={t('sitesNew.url')}>
        <input id="url" name="url" type="url" inputMode="url" required className="input font-mono" placeholder={t('sitesNew.urlPlaceholder')} defaultValue={f.url} autoFocus />
      </Field>
      <Field id="name" label={t('sitesNew.name')}>
        <input id="name" name="name" required maxLength={120} className="input" placeholder={t('sitesNew.namePlaceholder')} defaultValue={f.name} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="client_name" label={`${t('sitesNew.clientName')} (${t('common.optional')})`}>
          <input id="client_name" name="client_name" maxLength={120} className="input" defaultValue={f.client_name} />
        </Field>
        <Field id="report_locale" label={t('sitesNew.reportLocale')}>
          <select id="report_locale" name="report_locale" className="input" defaultValue={f.report_locale ?? defaultLocale}>
            {LOCALES.map(l => <option key={l} value={l}>{t(`common.locales.${l}` as MessageKey)}</option>)}
          </select>
        </Field>
      </div>
      <Field id="client_email" label={`${t('sitesNew.clientEmail')} (${t('common.optional')})`}>
        <input id="client_email" name="client_email" type="email" className="input" defaultValue={f.client_email} />
      </Field>
      <SubmitButton pendingLabel={t('common.saving')}>{t('sitesNew.submit')}</SubmitButton>
    </form>
  )
}
