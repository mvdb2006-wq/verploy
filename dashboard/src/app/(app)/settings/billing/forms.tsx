'use client'
import { useActionState } from 'react'
import { Alert } from '@/components/Alert'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { changePlan, setCancelAtPeriodEnd, startCheckout } from './actions'

export function PlanButton({ plan, mode, label }: { plan: string; mode: 'checkout' | 'change'; label: string }) {
  const [state, action] = useActionState(mode === 'checkout' ? startCheckout : changePlan, {})
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="plan" value={plan} />
      <SubmitButton variant={mode === 'checkout' ? 'primary' : 'ghost'} className="w-full">{label}</SubmitButton>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
    </form>
  )
}

export function CancelToggle({ cancelling }: { cancelling: boolean }) {
  const { t } = useI18n()
  const [state, action] = useActionState(setCancelAtPeriodEnd, {})
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="cancel" value={cancelling ? '0' : '1'} />
      <SubmitButton variant={cancelling ? 'primary' : 'danger'}>{cancelling ? t('billing.resume') : t('billing.cancel')}</SubmitButton>
      {!cancelling && <p className="text-xs text-subtle">{t('billing.cancelHint')}</p>}
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
    </form>
  )
}
