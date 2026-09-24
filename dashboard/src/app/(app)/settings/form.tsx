'use client'
import { useActionState } from 'react'
import { Alert } from '@/components/Alert'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { LOCALES, type MessageKey } from '@/lib/i18n/core'
import { useI18n } from '@/lib/i18n/client'
import { saveAgency, saveLogo, saveSecurity } from './actions'

export function AgencyForm({ defaults, disabled }: { defaults: { name: string; dashboard_locale: string; brand_color: string; report_sender_name: string }; disabled: boolean }) {
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
        <Field id="report_sender_name" label={t('reports.branding.sender')} hint={t('reports.branding.senderHint')}>
          <input id="report_sender_name" name="report_sender_name" maxLength={120} className="input" defaultValue={defaults.report_sender_name}
            placeholder={defaults.name} aria-describedby="report_sender_name-hint" />
        </Field>
        {!disabled && <SubmitButton pendingLabel={t('common.saving')}>{t('common.save')}</SubmitButton>}
      </fieldset>
    </form>
  )
}

export function LogoForm({ hasLogo, disabled }: { hasLogo: boolean; disabled: boolean }) {
  const { t } = useI18n()
  const [state, action] = useActionState(saveLogo, {})
  return (
    <section className="card space-y-4" aria-labelledby="logo-title">
      <div>
        <h2 id="logo-title" className="font-bold">{t('reports.branding.logo')}</h2>
        <p className="mt-1 text-sm text-muted">{t('reports.branding.logoHint')}</p>
      </div>
      {hasLogo && (
        // eslint-disable-next-line @next/next/no-img-element -- privé-afbeelding via eigen route
        <img src="/branding-logo" alt={t('reports.branding.current')} className="max-h-16 max-w-60 rounded-md bg-white p-2 object-contain" />
      )}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-3">
          <form action={action} className="flex flex-wrap items-center gap-3">
            <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" required aria-label={t('reports.branding.logo')}
              className="text-sm file:mr-3 file:rounded-lg file:border file:border-border2 file:bg-surface2 file:px-3 file:py-1.5 file:text-sm file:text-text" />
            <SubmitButton variant="ghost">{t('reports.branding.upload')}</SubmitButton>
          </form>
          {hasLogo && (
            <form action={action}>
              <input type="hidden" name="remove" value="1" />
              <SubmitButton variant="danger">{t('reports.branding.remove')}</SubmitButton>
            </form>
          )}
        </div>
      )}
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{t('common.saved')}</Alert>}
    </section>
  )
}

/** Keuze per bureau: ernstige/kritieke lekken eerst laten goedkeuren of direct automatisch veilig oplossen. */
export function SecurityForm({ autofix, disabled }: { autofix: boolean; disabled: boolean }) {
  const { t } = useI18n()
  const [state, action] = useActionState(saveSecurity, {})
  const options = [
    { value: 'approve', title: t('security.settings.approveTitle'), body: t('security.settings.approveBody') },
    { value: 'auto', title: t('security.settings.autoTitle'), body: t('security.settings.autoBody') },
  ]
  return (
    <form action={action} className="card space-y-4" id="security" aria-labelledby="security-settings-title">
      <div>
        <h2 id="security-settings-title" className="font-bold">{t('security.settings.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('security.settings.intro')}</p>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="sr-only">{t('security.settings.title')}</legend>
        {options.map(o => (
          <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-accent has-[:checked]:bg-accent/5">
            <input type="radio" name="security_mode" value={o.value} defaultChecked={(o.value === 'auto') === autofix}
              className="mt-1 size-4 shrink-0 accent-(--color-accent)" />
            <span>
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className="block text-sm text-muted">{o.body}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-subtle">{t('security.settings.note')}</p>
        {!disabled && <SubmitButton pendingLabel={t('common.saving')}>{t('common.save')}</SubmitButton>}
      </fieldset>
    </form>
  )
}
