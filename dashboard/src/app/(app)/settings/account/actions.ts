'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { requireAgency } from '@/lib/session'

export interface EnrollState { factorId?: string; qr?: string; secret?: string; error?: string; done?: boolean }

const CODE = /^\d{6}$/

/** Stap 1: nieuwe authenticator klaarzetten (QR-code en geheime sleutel). Oude, niet-afgemaakte pogingen weg. */
export async function startEnroll(): Promise<EnrollState> {
  await requireAgency()
  const t = await getT()
  const supabase = await createClient()
  const { data: factors } = await supabase.auth.mfa.listFactors()
  for (const f of factors?.all ?? []) {
    if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Verploy ${new Date().toISOString().slice(0, 16)}` })
  if (error || !data) return { error: t('mfa.errorStart') }
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
}

/** Stap 2: de eerste code uit de app bevestigt de authenticator (en maakt deze sessie meteen aal2). */
export async function confirmEnroll(_: EnrollState, form: FormData): Promise<EnrollState> {
  await requireAgency()
  const t = await getT()
  const code = String(form.get('code') ?? '').replace(/\s/g, '')
  const factorId = String(form.get('factor_id') ?? '')
  if (!factorId || !CODE.test(code)) return { error: t('mfa.errorCode') }
  const supabase = await createClient()
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) return { error: t('mfa.errorCode') }
  revalidatePath('/', 'layout')
  return { done: true }
}

export interface DisableState { error?: string }

/** Uitzetten kan alleen in een sessie die al met een code is bevestigd (Supabase eist aal2). */
export async function disable2fa(_: DisableState, form: FormData): Promise<DisableState> {
  await requireAgency()
  const t = await getT()
  const factorId = String(form.get('factor_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) return { error: t('mfa.errorDisable') }
  await supabase.auth.refreshSession()
  revalidatePath('/', 'layout')
  return {}
}
