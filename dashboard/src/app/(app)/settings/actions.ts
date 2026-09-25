'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { requireAgency } from '@/lib/session'
import { dbErrorKey } from '@/lib/db-errors'
import { LOCALES } from '@/lib/i18n/core'
import { env } from '@/lib/env'
import { renderEmail, sendEmail } from '@/lib/email'
import { createTranslator, isLocale, type MessageKey } from '@/lib/i18n/core'
import { FREQUENCIES, UPDATE_WINDOWS, validTimezone } from '@/lib/auto-updates/policy'

export interface SettingsState { error?: string; ok?: string }

export async function saveAgency(_: SettingsState, form: FormData): Promise<SettingsState> {
  const session = await requireAgency()
  const t = await getT()
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    dashboard_locale: z.enum(LOCALES),
    brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    report_sender_name: z.string().trim().max(120).transform(v => v || null),
  }).safeParse({ name: form.get('name'), dashboard_locale: form.get('dashboard_locale'), brand_color: form.get('brand_color'), report_sender_name: form.get('report_sender_name') ?? '' })
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    return { error: field === 'brand_color' ? t('settings.errorColor') : field === 'name' ? t('onboarding.errorName') : t('common.errorGeneric') }
  }
  const supabase = await createClient()
  const { error, count } = await supabase.from('agencies').update(parsed.data, { count: 'exact' }).eq('id', session.agency.id)
  if (error || count === 0) return { error: t(dbErrorKey(error, 'common.errorForbidden')) }
  revalidatePath('/', 'layout')
  // Na een taalwissel direct in de nieuwe taal bevestigen.
  return { ok: createTranslator(parsed.data.dashboard_locale)('common.saved') }
}

/** Wat Verploy doet bij ernstige en kritieke beveiligingslekken (eigenaar/beheerder; RLS dwingt dat af). */
export async function saveSecurity(_: SettingsState, form: FormData): Promise<SettingsState> {
  const session = await requireAgency()
  const t = await getT()
  const mode = String(form.get('security_mode') ?? '')
  if (mode !== 'approve' && mode !== 'auto') return { error: t('common.errorGeneric') }
  const supabase = await createClient()
  const { error, count } = await supabase.from('agencies').update({ security_autofix: mode === 'auto' }, { count: 'exact' }).eq('id', session.agency.id)
  if (error || count === 0) return { error: t(dbErrorKey(error, 'common.errorForbidden')) }
  revalidatePath('/', 'layout')
  return { ok: t('common.saved') }
}

/**
 * Automatische veilige updates: Aan/Uit, moment en frequentie (eigenaar/beheerder; RLS dwingt dat af).
 * De tijdzone komt uit de browser van wie het aanzet (de tijden gelden dan "zoals jij ze leest").
 */
export async function saveAutoUpdates(_: SettingsState, form: FormData): Promise<SettingsState> {
  const session = await requireAgency()
  const t = await getT()
  const parsed = z.object({
    auto_updates: z.enum(['on', 'off']),
    auto_update_window: z.enum(UPDATE_WINDOWS),
    auto_update_frequency: z.enum(FREQUENCIES),
    timezone: z.string().max(64).optional(),
  }).safeParse({
    auto_updates: form.get('auto_updates') === 'on' ? 'on' : 'off',
    auto_update_window: form.get('auto_update_window'),
    auto_update_frequency: form.get('auto_update_frequency'),
    timezone: form.get('timezone') || undefined,
  })
  if (!parsed.success) return { error: t('common.errorGeneric') }
  const tz = parsed.data.timezone && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(parsed.data.timezone) && validTimezone(parsed.data.timezone) ? parsed.data.timezone : undefined
  const supabase = await createClient()
  const { error, count } = await supabase.from('agencies').update({
    auto_updates: parsed.data.auto_updates === 'on',
    auto_update_window: parsed.data.auto_update_window,
    auto_update_frequency: parsed.data.auto_update_frequency,
    ...(tz ? { timezone: tz } : {}),
  }, { count: 'exact' }).eq('id', session.agency.id)
  if (error || count === 0) return { error: t(dbErrorKey(error, 'common.errorForbidden')) }
  revalidatePath('/', 'layout')
  return { ok: t('common.saved') }
}

/** Ochtendmail "Afgelopen nacht" aan of uit (eigenaar/beheerder; RLS dwingt dat af). */
export async function saveDigest(_: SettingsState, form: FormData): Promise<SettingsState> {
  const session = await requireAgency()
  const t = await getT()
  const supabase = await createClient()
  const { error, count } = await supabase.from('agencies').update({ daily_digest: form.get('daily_digest') === 'on' }, { count: 'exact' }).eq('id', session.agency.id)
  if (error || count === 0) return { error: t(dbErrorKey(error, 'common.errorForbidden')) }
  revalidatePath('/', 'layout')
  return { ok: t('common.saved') }
}

export interface InviteState { error?: string; link?: string; email?: string; emailed?: boolean }

export async function inviteMember(_: InviteState, form: FormData): Promise<InviteState> {
  const session = await requireAgency()
  const t = await getT()
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  const role = String(form.get('role') ?? 'member')
  if (!z.email().safeParse(email).success) return { error: t('team.errorEmail') }
  if (role !== 'member' && role !== 'admin') return { error: t('common.errorGeneric') }
  const supabase = await createClient()
  const { data: token, error } = await supabase.rpc('invite_member', { p_email: email, p_role: role })
  if (error || !token) return { error: t(dbErrorKey(error)) }

  const link = `${env().NEXT_PUBLIC_APP_URL}/invite/${token}`
  const locale = isLocale(session.agency.dashboard_locale) ? session.agency.dashboard_locale : 'nl'
  const mt = createTranslator(locale)
  const roleName = mt(`team.role.${role}` as MessageKey).toLowerCase()
  const vars = { agency: session.agency.name, inviter: session.user.email ?? '', role: roleName }
  const mail = renderEmail({
    heading: mt('email.inviteSubject', vars), body: mt('email.inviteBody', vars),
    cta: mt('email.inviteCta'), url: link, footer: mt('email.inviteFooter'),
  })
  const emailed = await sendEmail({ to: email, subject: mt('email.inviteSubject', vars), ...mail })
  revalidatePath('/settings/team')
  return { link, email, emailed }
}

export async function revokeInvitation(form: FormData): Promise<void> {
  await requireAgency()
  const supabase = await createClient()
  await supabase.from('agency_invitations').delete().eq('id', String(form.get('id') ?? ''))
  revalidatePath('/settings/team')
}

export async function changeRole(_: SettingsState, form: FormData): Promise<SettingsState> {
  await requireAgency()
  const t = await getT()
  const supabase = await createClient()
  const { error } = await supabase.rpc('update_member_role', { p_user: String(form.get('user_id') ?? ''), p_role: String(form.get('role') ?? '') })
  if (error) return { error: t(dbErrorKey(error)) }
  revalidatePath('/settings/team')
  return {}
}

export async function removeMember(_: SettingsState, form: FormData): Promise<SettingsState> {
  const session = await requireAgency()
  const t = await getT()
  const userId = String(form.get('user_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('remove_member', { p_user: userId })
  if (error) return { error: t(dbErrorKey(error)) }
  revalidatePath('/settings/team')
  if (userId === session.user.id) {
    const { redirect } = await import('next/navigation')
    redirect('/onboarding')
  }
  return {}
}

export interface LogoState { error?: string; ok?: boolean }

const LOGO_MAX = 1024 * 1024
/** Herkent het bestandstype aan de eerste bytes (niet aan de bestandsnaam of het opgegeven type). */
function sniffImage(buf: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

/** Logo voor rapporten uploaden of verwijderen (eigenaar/beheerder). */
export async function saveLogo(_: LogoState, form: FormData): Promise<LogoState> {
  const session = await requireAgency()
  const t = await getT()
  if (session.role !== 'owner' && session.role !== 'admin') return { error: t('common.errorForbidden') }
  const supabase = await createClient()
  const admin = (await import('@/lib/supabase/admin')).createAdminClient()
  const old = session.agency.brand_logo_path
  if (form.get('remove') === '1') {
    const { error } = await supabase.from('agencies').update({ brand_logo_path: null }).eq('id', session.agency.id)
    if (error) return { error: t(dbErrorKey(error)) }
    if (old) await admin.storage.from('branding').remove([old])
    revalidatePath('/settings')
    return { ok: true }
  }
  const file = form.get('logo')
  if (!(file instanceof File) || file.size === 0 || file.size > LOGO_MAX) return { error: t('reports.branding.errorType') }
  const buf = Buffer.from(await file.arrayBuffer())
  const ext = sniffImage(buf)
  if (!ext) return { error: t('reports.branding.errorType') }
  const path = `${session.agency.id}/logo-${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await admin.storage.from('branding').upload(path, buf, { contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` })
  if (upErr) return { error: t('common.errorGeneric') }
  const { error } = await supabase.from('agencies').update({ brand_logo_path: path }).eq('id', session.agency.id)
  if (error) {
    await admin.storage.from('branding').remove([path])
    return { error: t(dbErrorKey(error)) }
  }
  if (old && old !== path) await admin.storage.from('branding').remove([old])
  revalidatePath('/settings')
  return { ok: true }
}
