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
  // Eén veilige update per site, met alle getroffen onderdelen (bijv. thema én plugin met hetzelfde lek).
  const perSite = new Map<string, Array<{ type: string; slug: string }>>()
  for (const f of targets) perSite.set(f.site_id, [...(perSite.get(f.site_id) ?? []), { type: f.component_type, slug: f.component_slug }])
  let started = 0
  let failed = 0
  for (const [site, items] of perSite) {
    const { error } = await supabase.rpc('create_update_run', { p_site: site, p_items: items })
    if (error) failed++
    else started++
  }
  revalidatePath('/', 'layout')
  if (started === 0) return { error: t('ops.inbox.startFailed', { count: Math.max(failed, 1) }) }
  return { ok: [t('ops.inbox.started', { count: started }), failed ? t('ops.inbox.startFailed', { count: failed }) : ''].filter(Boolean).join(' ') }
}

/**
 * "Veilig oplossen" vanuit de inbox: één onderdeel (type + slug) op de gekozen sites. Alleen sites waar
 * dat onderdeel nu echt een open, oplosbaar lek heeft (opnieuw bepaald, niet uit het formulier overgenomen).
 */
export async function fixComponent(_: FixState, form: FormData): Promise<FixState> {
  await requireAgency()
  const t = await getT()
  const type = String(form.get('component_type') ?? '')
  const slug = String(form.get('component_slug') ?? '')
  const onlySites = form.getAll('site_id').map(String).filter(Boolean)
  if (!type || !slug || !onlySites.length) return { error: t('common.errorGeneric') }
  const supabase = await createClient()
  const { data: findings } = await supabase.from('site_vulnerabilities').select('site_id')
    .eq('component_type', type).eq('component_slug', slug).eq('status', 'open').eq('fixable', true).in('site_id', onlySites)
  const sites = [...new Set((findings ?? []).map(f => f.site_id))]
  let started = 0
  let failed = 0
  for (const site of sites) {
    const { error } = await supabase.rpc('create_update_run', { p_site: site, p_items: [{ type, slug }] })
    if (error) failed++
    else started++
  }
  revalidatePath('/', 'layout')
  if (started === 0) return { error: t('ops.inbox.startFailed', { count: Math.max(failed, 1) }) }
  return { ok: [t('ops.inbox.started', { count: started }), failed ? t('ops.inbox.startFailed', { count: failed }) : ''].filter(Boolean).join(' ') }
}
