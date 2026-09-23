'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { dbErrorKey } from '@/lib/db-errors'

export async function cancelRun(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const t = await getT()
  const runId = String(form.get('run_id') ?? '')
  const siteId = String(form.get('site_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_update_run', { p_run: runId })
  if (error) return { error: t(dbErrorKey(error)) }
  revalidatePath(`/sites/${siteId}/runs/${runId}`)
  return {}
}
