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

export interface SettingsState { error?: string; ok?: string }

export async function saveAgency(_: SettingsState, form: FormData): Promise<SettingsState> {
  const session = await requireAgency()
  const t = await getT()
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    dashboard_locale: z.enum(LOCALES),
    brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  }).safeParse({ name: form.get('name'), dashboard_locale: form.get('dashboard_locale'), brand_color: form.get('brand_color') })
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
