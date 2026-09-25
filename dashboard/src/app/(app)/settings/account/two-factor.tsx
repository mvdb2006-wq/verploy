'use client'
import { useActionState, useState, useTransition } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { confirmEnroll, disable2fa, startEnroll, type EnrollState } from './actions'

/** Tweestapsverificatie aan/uit: QR-code scannen, één code invoeren, klaar. */
export function TwoFactor({ enabled, factorId }: { enabled: boolean; factorId: string | null }) {
  const { t } = useI18n()
  const [enroll, setEnroll] = useState<EnrollState | null>(null)
  const [pending, start] = useTransition()
  const [confirmState, confirm] = useActionState(confirmEnroll, {})
  const [disableState, disable] = useActionState(disable2fa, {})
  const current = enroll

  if (enabled || confirmState.done) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-accent"><ShieldCheck size={16} aria-hidden /> {t('mfa.on')}</p>
        <p className="text-sm text-muted">{t('mfa.onBody')}</p>
        {disableState.error && <Alert>{disableState.error}</Alert>}
        {factorId && (
          <form action={disable}>
            <input type="hidden" name="factor_id" value={factorId} />
            <SubmitButton variant="ghost" pendingLabel={t('common.saving')}>{t('mfa.disable')}</SubmitButton>
          </form>
        )}
      </div>
    )
  }

  if (!current?.factorId) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('mfa.offBody')}</p>
        {current?.error && <Alert>{current.error}</Alert>}
        <button type="button" className="btn btn-primary" disabled={pending}
          onClick={() => start(async () => setEnroll(await startEnroll()))}>
          <ShieldCheck size={15} aria-hidden /> {t('mfa.enable')}
        </button>
      </div>
    )
  }

  return (
    <form action={confirm} className="space-y-4">
      <input type="hidden" name="factor_id" value={current.factorId} />
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>{t('mfa.step1')}</li>
        <li>{t('mfa.step2')}</li>
      </ol>
      {current.qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={current.qr} alt={t('mfa.qrAlt')} width={180} height={180} className="rounded-lg bg-white p-2" />
      )}
      <p className="text-xs text-muted">{t('mfa.manual')} <code className="font-mono text-text" data-testid="mfa-secret">{current.secret}</code></p>
      {confirmState.error && <Alert>{confirmState.error}</Alert>}
      <Field id="mfa-code" label={t('mfa.code')}>
        <input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className="input max-w-40 font-mono tracking-widest" />
      </Field>
      <SubmitButton pendingLabel={t('common.saving')}>{t('mfa.confirm')}</SubmitButton>
    </form>
  )
}
