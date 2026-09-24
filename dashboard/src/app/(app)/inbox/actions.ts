'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { requireAgency } from '@/lib/session'

export interface FixState { ok?: string; error?: string }

/**
 * "Veilig oplossen op N sites": start per getroffen site een gewone veilige update voor het
 * betrokken onderdeel. De sites worden hier opnieuw bepaald (niet uit het formulier overgenomen);
 * create_update_run controleert rechten, abonnement en of er al iets loopt.
 */
export async function fixVulnerability(_: FixState, form: FormData): Promise<FixState> {
  await requireAgency()
  const t = await getT()
  const vulnerabilityId = String(form.get('vulnerability_id') ?? '')
  const onlySites = form.getAll('site_id').map(String).filter(Boolean)
  if (!vulnerabilityId) return { error: t('common.errorGeneric') }
  const supabase = await createClient()
  const { data: findings } = await supabase.from('site_vulnerabilities')
    .select('site_id, component_type, component_slug')
    .eq('vulnerability_id', vulnerabilityId).eq('status', 'open').eq('fixable', true)
  const targets = (findings ?? []).filter(f => onlySites.length === 0 || onlySites.includes(f.site_id))
  let started = 0
  let failed = 0
  for (const f of targets) {
    const { error } = await supabase.rpc('create_update_run', { p_site: f.site_id, p_items: [{ type: f.component_type, slug: f.component_slug }] })
    if (error) failed++
    else started++
  }
  revalidatePath('/', 'layout')
  if (started === 0) return { error: t('ops.inbox.startFailed', { count: Math.max(failed, 1) }) }
  return { ok: [t('ops.inbox.started', { count: started }), failed ? t('ops.inbox.startFailed', { count: failed }) : ''].filter(Boolean).join(' ') }
}
