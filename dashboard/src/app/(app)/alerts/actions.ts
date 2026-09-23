'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAgency } from '@/lib/session'

export async function acknowledgeAlert(form: FormData): Promise<void> {
  await requireAgency()
  const supabase = await createClient()
  await supabase.rpc('acknowledge_alert', { p_alert: String(form.get('id') ?? '') })
  revalidatePath('/', 'layout')
}
