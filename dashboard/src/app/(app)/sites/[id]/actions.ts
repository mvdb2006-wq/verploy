'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { dbErrorKey } from '@/lib/db-errors'

export interface PairingState { code?: string; expiresAt?: string; error?: string }

export async function createPairingCode(_: PairingState, form: FormData): Promise<PairingState> {
  const t = await getT()
  const siteId = String(form.get('site_id') ?? '')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_pairing_code', { p_site: siteId })
  if (error || !data) return { error: t(dbErrorKey(error)) }
  return { code: data, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }
}

export async function deleteSite(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const t = await getT()
  const siteId = String(form.get('site_id') ?? '')
  const confirmName = String(form.get('confirm') ?? '').trim()
  const supabase = await createClient()
  const { data: site } = await supabase.from('sites').select('name').eq('id', siteId).single()
  if (!site || site.name !== confirmName) return { error: t('siteDetail.deleteConfirm', { name: site?.name ?? '' }) }
  const { error, count } = await supabase.from('sites').delete({ count: 'exact' }).eq('id', siteId)
  if (error || count === 0) return { error: t(dbErrorKey(error, 'common.errorForbidden')) }
  revalidatePath('/')
  redirect('/sites')
}

export interface RunState { error?: string }

/** Start een veilige update voor de aangevinkte componenten ("type:slug"). */
export async function startRun(_: RunState, form: FormData): Promise<RunState> {
  const t = await getT()
  const siteId = String(form.get('site_id') ?? '')
  const items = form.getAll('item').map(String).map(v => {
    const i = v.indexOf(':')
    return { type: v.slice(0, i), slug: v.slice(i + 1) }
  }).filter(i => ['plugin', 'theme', 'core'].includes(i.type) && i.slug)
  if (!items.length) return { error: t('runs.errorNoItems') }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_update_run', { p_site: siteId, p_items: items })
  if (error || !data) return { error: t(dbErrorKey(error)) }
  revalidatePath(`/sites/${siteId}`)
  redirect(`/sites/${siteId}/runs/${data}`)
}

export interface SettingsState { error?: string; saved?: boolean }

/** Testinstellingen: extra pagina's, te maskeren onderdelen en de pixeldrempel. */
export async function saveTestSettings(_: SettingsState, form: FormData): Promise<SettingsState> {
  const t = await getT()
  const siteId = String(form.get('site_id') ?? '')
  const lines = (name: string) => String(form.get(name) ?? '').split('\n').map(s => s.trim()).filter(Boolean)
  const paths = lines('test_paths')
  const masks = lines('test_masks')
  const threshold = Number(String(form.get('diff_threshold') ?? '').replace(',', '.'))
  if (paths.length > 5 || paths.some(p => !/^\/[^\s]*$/.test(p) || p.length > 200)) return { error: t('runs.settings.errorPaths') }
  if (masks.length > 10 || masks.some(m => m.length > 200 || /[{}<>]/.test(m))) return { error: t('runs.settings.errorMasks') }
  if (!Number.isFinite(threshold) || threshold < 0.1 || threshold > 50) return { error: t('runs.settings.errorThreshold') }
  const supabase = await createClient()
  const { error, count } = await supabase.from('sites')
    .update({ test_paths: paths, test_masks: masks, diff_threshold: Math.round(threshold * 10) / 1000 }, { count: 'exact' })
    .eq('id', siteId)
  if (error || count === 0) return { error: t(dbErrorKey(error, 'common.errorForbidden')) }
  revalidatePath(`/sites/${siteId}`)
  return { saved: true }
}

export interface ClientState { error?: string; saved?: boolean }

/** Klantgegevens en rapportinstellingen van een site (eigenaar/beheerder; RLS dwingt dat af). */
export async function saveClientSettings(_: ClientState, form: FormData): Promise<ClientState> {
  const t = await getT()
  const siteId = String(form.get('site_id') ?? '')
  const clientName = String(form.get('client_name') ?? '').trim()
  const clientEmail = String(form.get('client_email') ?? '').trim().toLowerCase()
  const locale = String(form.get('report_locale') ?? '')
  const monthly = form.get('report_monthly') === 'on'
  if (clientEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail)) return { error: t('reports.site.errorEmail') }
  if (monthly && !clientEmail) return { error: t('reports.site.errorMonthly') }
  if (!['nl', 'en', 'de', 'fr', 'es'].includes(locale) || clientName.length > 120) return { error: t('common.errorGeneric') }
  const supabase = await createClient()
  const { error, count } = await supabase.from('sites').update({
    client_name: clientName || null, client_email: clientEmail || null, report_locale: locale, report_monthly: monthly,
  }, { count: 'exact' }).eq('id', siteId)
  if (error || count === 0) return { error: t(dbErrorKey(error, 'common.errorForbidden')) }
  revalidatePath(`/sites/${siteId}`)
  return { saved: true }
}

export interface AutoState { error?: string }

/** "Nooit automatisch" voor één site (of weer meedoen). Eigenaar/beheerder; RLS dwingt dat af. */
export async function setSiteAutoUpdates(_: AutoState, form: FormData): Promise<AutoState> {
  const t = await getT()
  const siteId = String(form.get('site_id') ?? '')
  const on = form.get('auto_updates') === 'on'
  const supabase = await createClient()
  const { error, count } = await supabase.from('sites').update({ auto_updates: on }, { count: 'exact' }).eq('id', siteId)
  if (error || count === 0) return { error: t(dbErrorKey(error, 'common.errorForbidden')) }
  revalidatePath(`/sites/${siteId}`)
  return {}
}

export interface WpLoginState { error?: string; saved?: boolean }

/** Als welke WordPress-beheerder "Inloggen in WP Admin" inlogt (leeg = de eerste beheerder). Eigenaar/beheerder; RLS. */
export async function setWpLoginUser(_: WpLoginState, form: FormData): Promise<WpLoginState> {
  const t = await getT()
  const siteId = String(form.get('site_id') ?? '')
  const raw = String(form.get('wp_user_id') ?? '')
  const user = raw === '' ? null : Number(raw)
  if (user !== null && (!Number.isInteger(user) || user <= 0)) return { error: t('common.errorGeneric') }
  const supabase = await createClient()
  const { error, count } = await supabase.from('sites').update({ wp_login_user_id: user }, { count: 'exact' }).eq('id', siteId)
  if (error || count === 0) return { error: t(dbErrorKey(error, 'common.errorForbidden')) }
  revalidatePath(`/sites/${siteId}`)
  return { saved: true }
}
