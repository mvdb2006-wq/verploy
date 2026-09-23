'use client'
import { useActionState } from 'react'
import { Alert } from '@/components/Alert'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { LOCALES, type MessageKey } from '@/lib/i18n/core'
import { useI18n } from '@/lib/i18n/client'
import { saveAgency } from './actions'

export function AgencyForm({ defaults, disabled }: { defaults: { name: string; dashboard_locale: string; brand_color: string }; disabled: boolean }) {
  const { t } = useI18n()
  const [state, action] = useActionState(saveAgency, {})
  return (
    <form action={action} className="card space-y-5">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
      <fieldset disabled={disabled} className="space-y-5">
        <Field id="name" label={t('settings.name')}>
          <input id="name" name="name" required minLength={2} maxLength={120} className="input" defaultValue={defaults.name} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="dashboard_locale" label={t('settings.locale')}>
            <select id="dashboard_locale" name="dashboard_locale" className="input" defaultValue={defaults.dashboard_locale}>
              {LOCALES.map(l => <option key={l} value={l}>{t(`common.locales.${l}` as MessageKey)}</option>)}
            </select>
          </Field>
          <Field id="brand_color" label={t('settings.brandColor')} hint={t('settings.brandColorHint')}>
            <div className="flex gap-2">
              <input aria-hidden tabIndex={-1} type="color" className="h-[42px] w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-bg p-1"
                defaultValue={defaults.brand_color}
                onChange={e => { const el = document.getElementById('brand_color') as HTMLInputElement | null; if (el) el.value = e.target.value.toUpperCase() }} />
              <input id="brand_color" name="brand_color" className="input font-mono uppercase" defaultValue={defaults.brand_color}
                pattern="#[0-9A-Fa-f]{6}" aria-describedby="brand_color-hint" />
            </div>
          </Field>
        </div>
        {!disabled && <SubmitButton pendingLabel={t('common.saving')}>{t('common.save')}</SubmitButton>}
      </fieldset>
    </form>
  )
}
