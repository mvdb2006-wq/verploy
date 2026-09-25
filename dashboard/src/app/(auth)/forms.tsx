'use client'
import Link from 'next/link'
import { useActionState } from 'react'
import { Alert } from '@/components/Alert'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { login, requestPasswordReset, signup, updatePassword, verifyTwoFactor, type FormState } from './actions'

const initial: FormState = {}

export function LoginForm({ next, defaultEmail }: { next: string; defaultEmail?: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(login, initial)
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error && <Alert>{state.error}</Alert>}
      <Field id="email" label={t('auth.email')}>
        <input id="email" name="email" type="email" autoComplete="email" required className="input"
          defaultValue={state.email ?? defaultEmail} />
      </Field>
      <Field id="password" label={t('auth.password')}>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </Field>
      <div className="flex items-center justify-between pt-1">
        <SubmitButton pendingLabel={t('auth.login.submitting')}>{t('auth.login.submit')}</SubmitButton>
        <Link href="/forgot-password" className="text-sm text-muted hover:text-text">{t('auth.login.forgot')}</Link>
      </div>
    </form>
  )
}

export function SignupForm({ next, defaultEmail, plan = null }: { next: string; defaultEmail?: string; plan?: string | null }) {
  const { t } = useI18n()
  const [state, action] = useActionState(signup, initial)
  if (state.ok) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-bold">{t('auth.signup.checkEmailTitle')}</h2>
        <p className="text-sm text-muted">{state.ok}</p>
      </div>
    )
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {plan && <input type="hidden" name="plan" value={plan} />}
      {state.error && <Alert>{state.error}</Alert>}
      <Field id="email" label={t('auth.email')}>
        <input id="email" name="email" type="email" autoComplete="email" required className="input"
          defaultValue={state.email ?? defaultEmail} />
      </Field>
      <Field id="password" label={t('auth.password')} hint={t('auth.signup.passwordHint')}>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required
          className="input" aria-describedby="password-hint" />
      </Field>
      <SubmitButton pendingLabel={t('auth.signup.submitting')} className="w-full">{t('auth.signup.submit')}</SubmitButton>
    </form>
  )
}

export function ForgotForm() {
  const { t } = useI18n()
  const [state, action] = useActionState(requestPasswordReset, initial)
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
      <Field id="email" label={t('auth.email')}>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" />
      </Field>
      <SubmitButton className="w-full">{t('auth.forgot.submit')}</SubmitButton>
    </form>
  )
}

export function UpdatePasswordForm() {
  const { t } = useI18n()
  const [state, action] = useActionState(updatePassword, initial)
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
      <Field id="password" label={t('auth.reset.newPassword')} hint={t('auth.signup.passwordHint')}>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className="input" />
      </Field>
      <SubmitButton pendingLabel={t('common.saving')} className="w-full">{t('auth.reset.submit')}</SubmitButton>
      {state.ok && <Link href="/" className="btn btn-ghost w-full">{t('nav.sites')}</Link>}
    </form>
  )
}

export function TwoFactorForm({ next, factorId }: { next: string; factorId: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(verifyTwoFactor, initial)
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="factor_id" value={factorId} />
      {state.error && <Alert>{state.error}</Alert>}
      <Field id="code" label={t('mfa.code')}>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus
          className="input font-mono tracking-widest" />
      </Field>
      <SubmitButton pendingLabel={t('auth.login.submitting')}>{t('mfa.loginSubmit')}</SubmitButton>
      <p className="text-xs text-subtle">{t('mfa.lost')}</p>
    </form>
  )
}
