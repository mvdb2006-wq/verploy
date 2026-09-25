'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { requireAgency } from '@/lib/session'

export interface BulkState { ok?: string; error?: string }

/**
 * "Veilig bijwerken op alle N sites": per site een gewone veilige update voor dit ene onderdeel (eerst op
 * een testkopie, dan live, met rollback). De sites worden hier opnieuw bepaald; create_update_run
 * controleert rechten, abonnement en of er al iets loopt.
 */
export async function updateEverywhere(_: BulkState, form: FormData): Promise<BulkState> {
  await requireAgency()
  const t = await getT()
  const type = String(form.get('type') ?? '')
  const slug = String(form.get('slug') ?? '')
  if (!type || !slug) return { error: t('common.errorGeneric') }
  const supabase = await createClient()
  const { data: comps } = await supabase.from('site_components').select('site_id').eq('type', type).eq('slug', slug).eq('update_available', true)
  const sites = [...new Set((comps ?? []).map(c => c.site_id))]
  let started = 0
  let busy = 0
  let failed = 0
  for (const site of sites) {
    const { error } = await supabase.rpc('create_update_run', { p_site: site, p_items: [{ type, slug }] })
    if (!error) started++
    else if (error.message.includes('run_active')) busy++
    else failed++
  }
  revalidatePath('/', 'layout')
  if (!started) return { error: busy ? t('bulk.allBusy', { count: busy }) : t('ops.inbox.startFailed', { count: Math.max(failed, 1) }) }
  return { ok: [t('ops.inbox.started', { count: started }), busy ? t('bulk.someBusy', { count: busy }) : '', failed ? t('ops.inbox.startFailed', { count: failed }) : ''].filter(Boolean).join(' ') }
}
