import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import NewSiteForm from './NewSiteForm'

export const metadata = { title: 'Site toevoegen' }

export default async function NewSitePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('agency_members')
    .select('agency_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) redirect('/dashboard')

  async function addSite(
    prevState: { error?: string } | null,
    formData: FormData,
  ): Promise<{ error?: string } | null> {
    'use server'
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')

    const { data: membership } = await supabase
      .from('agency_members')
      .select('agency_id')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return { error: 'Geen bureau-lidmaatschap gevonden. Neem contact op met support.' }
    }

    const name       = (formData.get('name')        as string | null) ?? ''
    const rawUrl     = (formData.get('url')          as string | null) ?? ''
    const clientName = (formData.get('client_name') as string | null) ?? ''
    const url        = rawUrl.replace(/\/$/, '').trim()

    if (!name.trim())  return { error: 'Vul een sitenaam in.' }
    if (!url)          return { error: 'Vul een geldige website-URL in.' }

    const { data: site, error } = await supabase
      .from('sites')
      .insert({
        agency_id:   membership.agency_id,
        name:        name.trim(),
        url,
        client_name: clientName.trim() || null,
        status:      'unknown',
      })
      .select('id, api_key')
      .single()

    if (error || !site) {
      console.error('[verploy] Fout bij aanmaken site:', error)
      return { error: error?.message ?? 'Onbekende fout bij aanmaken site. Probeer het opnieuw.' }
    }

    revalidatePath('/settings')
    revalidatePath('/dashboard')
    redirect(`/settings/sites/new/success?id=${site.id}&key=${site.api_key}`)
  }

  return <NewSiteForm addSite={addSite} />
}
