'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { env } from '@/lib/env'
import { getT } from '@/lib/i18n/server'
import { safeNext } from '@/lib/safe-next'

export interface FormState { error?: string; ok?: string; email?: string }

const email = z.email().max(254)

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const t = await getT()
  const parsed = z.object({ email, password: z.string().min(1).max(200) }).safeParse({
    email: String(form.get('email') ?? '').trim().toLowerCase(),
    password: String(form.get('password') ?? ''),
  })
  if (!parsed.success) return { error: t('auth.login.errorInvalid') }
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) {
    return { error: error.code === 'email_not_confirmed' ? t('auth.login.errorUnconfirmed') : t('auth.login.errorInvalid'), email: parsed.data.email }
  }
  redirect(safeNext(String(form.get('next') ?? ''), '/'))
}

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  const t = await getT()
  const parsed = z.object({ email, password: z.string().min(10).max(200) }).safeParse({
    email: String(form.get('email') ?? '').trim().toLowerCase(),
    password: String(form.get('password') ?? ''),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues.some(i => i.path[0] === 'password') ? t('auth.signup.errorWeak') : t('sitesNew.errorEmail') }
  }
  const next = safeNext(String(form.get('next') ?? ''), '/onboarding')
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${env().NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}` },
  })
  if (error) {
    if (error.code === 'signup_disabled') return { error: t('auth.signup.errorClosed') }
    if (error.code === 'user_already_exists') return { error: t('auth.signup.errorExists') }
    if (error.code === 'weak_password') return { error: t('auth.signup.errorWeak') }
    return { error: t('common.errorGeneric') }
  }
  // Met automatische bevestiging (lokaal) is er meteen een sessie.
  if (data.session) redirect(next)
  // Supabase geeft voor een bestaand adres een gebruiker zonder identiteiten terug (anti-enumeratie).
  return { ok: t('auth.signup.checkEmailBody', { email: parsed.data.email }), email: parsed.data.email }
}

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const t = await getT()
  const value = String(form.get('email') ?? '').trim().toLowerCase()
  if (!email.safeParse(value).success) return { error: t('team.errorEmail') }
  const supabase = await createClient()
  await supabase.auth.resetPasswordForEmail(value, {
    redirectTo: `${env().NEXT_PUBLIC_APP_URL}/auth/callback?next=/auth/update-password`,
  })
  // Altijd dezelfde melding: verraadt niet of er een account bestaat.
  return { ok: t('auth.forgot.sent', { email: value }) }
}

export async function updatePassword(_: FormState, form: FormData): Promise<FormState> {
  const t = await getT()
  const password = String(form.get('password') ?? '')
  if (password.length < 10) return { error: t('auth.signup.errorWeak') }
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { error: error.code === 'weak_password' ? t('auth.signup.errorWeak') : t('auth.linkInvalid') }
  return { ok: t('auth.reset.done') }
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
