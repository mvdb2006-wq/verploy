'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/billing/stripe'
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

export interface DeleteAgencyState { error?: string }

/**
 * Bureau en account verwijderen (alleen de eigenaar). Eerst het Stripe-abonnement direct stoppen, dan het
 * bureau met alle sites, runs, rapporten en meldingen; de bestanden in Storage ruimt de worker op. Daarna
 * worden de accounts van iedereen in het team verwijderd. Facturen blijven bij Stripe (bewaarplicht).
 */
export async function deleteAgency(_: DeleteAgencyState, form: FormData): Promise<DeleteAgencyState> {
  const session = await requireAgency()
  const t = await getT()
  if (session.role !== 'owner') return { error: t('accountDelete.ownerOnly') }
  const confirm = String(form.get('confirm') ?? '').trim()
  if (confirm !== session.agency.name) return { error: t('accountDelete.confirmMismatch', { name: session.agency.name }) }

  const admin = createAdminClient()
  const { count } = await admin.from('update_runs').select('id', { count: 'exact', head: true })
    .eq('agency_id', session.agency.id).neq('status', 'done')
  if (count) return { error: t('accountDelete.runActive') }

  const subId = session.agency.stripe_subscription_id
  if (subId) {
    const s = stripe()
    if (!s) return { error: t('accountDelete.error') }
    try {
      await s.subscriptions.cancel(subId)
    } catch (err) {
      // Al gestopt of niet meer bekend bij Stripe: dan is er niets meer te stoppen.
      if ((err as { code?: string }).code !== 'resource_missing') {
        console.error('[account] abonnement stoppen mislukt', (err as Error).message)
        return { error: t('accountDelete.error') }
      }
    }
  }

  const supabase = await createClient()
  const { data: users, error } = await supabase.rpc('delete_agency', { p_confirm: confirm })
  if (error) {
    return { error: /run_active/.test(error.message) ? t('accountDelete.runActive')
      : /confirm_mismatch/.test(error.message) ? t('accountDelete.confirmMismatch', { name: session.agency.name })
      : t('accountDelete.error') }
  }
  for (const u of users ?? []) {
    const { error: dErr } = await admin.auth.admin.deleteUser(u.user_id)
    if (dErr) console.error('[account] gebruiker verwijderen mislukt', u.user_id, dErr.message)
  }
  await supabase.auth.signOut().catch(() => undefined)
  redirect('/login?deleted=1')
}
