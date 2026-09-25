/**
 * Geplande veilige updates uitvoeren (worker, service role). Per site die meedoet:
 *   1. bepalen wat Verploy zelf mag doen en wat op akkoord wacht (policy.ts);
 *   2. de vraag om akkoord in de inbox bijwerken (één per site; vervalt vanzelf);
 *   3. binnen het gekozen moment: de veilige update starten (trigger 'scheduled').
 * De run zelf is een gewone veilige update: eerst op een testkopie, pas daarna live, met rollback.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/database.types'
import type { RunItem } from '@/lib/run-items'
import { intelMap } from '@/lib/updates/intel'
import { isDue, inWindow, plan, type Component, type Frequency, type PastRun, type UpdateWindow } from './policy'

type Admin = SupabaseClient<Database>

/** Hoe ver terug eerdere pogingen meetellen (daarna mag een tegengehouden versie opnieuw). */
const HISTORY_DAYS = 60

export interface ScheduleResult { sites: number; started: number; approvals: number; cleared: number }

export async function runScheduledUpdates(admin: Admin, now = new Date()): Promise<ScheduleResult> {
  const result: ScheduleResult = { sites: 0, started: 0, approvals: 0, cleared: 0 }
  const { data: cleared, error: clErr } = await admin.rpc('clear_update_approvals_outside_schedule')
  if (clErr) throw clErr
  result.cleared = cleared ?? 0

  const { data: candidates, error } = await admin.rpc('scheduled_update_candidates', { p_limit: 500 })
  if (error) throw error
  for (const c of candidates ?? []) {
    result.sites++
    const [{ data: comps, error: cErr }, { data: runs, error: rErr }, { data: vulns, error: vErr }] = await Promise.all([
      admin.from('site_components').select('type, slug, name, version, latest_version').eq('site_id', c.site_id).eq('update_available', true),
      admin.from('update_runs').select('status, verdict, items').eq('site_id', c.site_id).eq('status', 'done')
        .gte('created_at', new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString()),
      admin.from('site_vulnerabilities').select('component_type, component_slug').eq('site_id', c.site_id).eq('status', 'open'),
    ])
    if (cErr) throw cErr
    if (rErr) throw rErr
    if (vErr) throw vErr
    const past: PastRun[] = (runs ?? []).map(r => ({ status: r.status, verdict: r.verdict, items: r.items as unknown as RunItem[] }))
    const vulnerable = new Set((vulns ?? []).map(v => `${v.component_type}:${v.component_slug}`))
    // Hoe deze versies elders gingen (over alle sites): een versie die elders vaak misging, wacht op akkoord.
    const slugs = [...new Set((comps ?? []).map(x => x.slug))]
    const { data: intel, error: iErr } = slugs.length
      ? await admin.from('update_intel').select('type, slug, version, ok_sites, failed_sites').in('slug', slugs)
      : { data: [], error: null }
    if (iErr) throw iErr
    const p = plan((comps ?? []) as Component[], past, vulnerable, intelMap(intel ?? []))

    const { error: aErr } = await admin.rpc('sync_update_approvals', { p_site: c.site_id, p_items: p.approvals as unknown as Json })
    if (aErr) throw aErr
    if (p.approvals.length) result.approvals++

    if (c.busy || !p.run.length) continue
    const window = c.update_window as UpdateWindow
    const due = isDue({ now, timezone: c.timezone, window, frequency: c.frequency as Frequency, lastScheduledAt: c.last_scheduled_at })
    // Een losse herkansing mag vaker binnen hetzelfde venster: zo is een tegengehouden groep in één nacht uitgezocht.
    if (!due && !(p.retry && inWindow(now, c.timezone, window))) continue
    const { data: runId, error: sErr } = await admin.rpc('start_scheduled_update', { p_site: c.site_id, p_items: p.run as unknown as Json })
    if (sErr) throw sErr
    if (runId) result.started++
  }
  return result
}
