'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'

export async function createAgency(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const t = await getT()
  const name = String(form.get('name') ?? '').trim()
  if (name.length < 2 || name.length > 120) return { error: t('onboarding.errorName') }
  // Dashboardtaal van het nieuwe bureau = de taal van de browser (terugval Engels); later te wijzigen in Instellingen.
  const locale = await getLocale()
  const supabase = await createClient()
  const { data: agencyId, error } = await supabase.rpc('create_agency', { p_name: name })
  if (error) return { error: error.message.includes('already_member') ? t('onboarding.errorAlready') : t('common.errorGeneric') }
  if (agencyId) await supabase.from('agencies').update({ dashboard_locale: locale }).eq('id', agencyId)
  redirect('/')
}
