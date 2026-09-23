'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { dbErrorKey } from '@/lib/db-errors'

export async function acceptInvitation(form: FormData): Promise<void> {
  const token = String(form.get('token') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('accept_invitation', { p_token: token })
  if (error) {
    const key = error.message.includes('already_member') ? 'invite.errorAlready' : dbErrorKey(error, 'invite.errorInvalid')
    redirect(`/invite/${encodeURIComponent(token)}?error=${key}`)
  }
  redirect('/')
}
