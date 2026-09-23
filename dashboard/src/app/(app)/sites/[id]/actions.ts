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
  redirect('/')
}
