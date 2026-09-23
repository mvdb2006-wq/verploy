'use client'
import { useActionState } from 'react'
import { Alert } from '@/components/Alert'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { createAgency } from './actions'

export function OnboardingForm() {
  const { t } = useI18n()
  const [state, action] = useActionState(createAgency, {})
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      <Field id="name" label={t('onboarding.name')}>
        <input id="name" name="name" required minLength={2} maxLength={120} className="input" placeholder={t('onboarding.namePlaceholder')} autoFocus />
      </Field>
      <SubmitButton pendingLabel={t('common.saving')} className="w-full">{t('onboarding.submit')}</SubmitButton>
    </form>
  )
}
