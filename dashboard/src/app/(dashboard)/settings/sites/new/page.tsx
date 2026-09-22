
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

  async function addSite(formData: FormData) {
    'use server'
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')

    const { data: membership } = await supabase
      .from('agency_members')
      .select('agency_id')
      .eq('user_id', user.id)
      .single()

    if (!membership) return

    const name = formData.get('name') as string
    const url = (formData.get('url') as string).replace(/\/$/, '') // strip trailing slash
    const clientName = (formData.get('client_name') as string) || null

    const { data: site, error } = await supabase
      .from('sites')
      .insert({
        agency_id: membership.agency_id,
        name: name.trim(),
        url: url.trim(),
        client_name: clientName?.trim() || null,
        status: 'unknown',
      })
      .select('id, api_key')
      .single()

    if (error || !site) {
      console.error('Fout bij aanmaken site:', error)
      return
    }

    revalidatePath('/settings')
    revalidatePath('/dashboard')
    redirect(`/settings/sites/new/success?id=${site.id}&key=${site.api_key}`)
  }

  return <NewSiteForm addSite={addSite} />
}
