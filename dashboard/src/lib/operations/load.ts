import 'server-only'
import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { daysAgoIso, effectiveStatus } from '@/lib/format'
import {
  groupFindings, inboxItems, median, portfolioHealth, isSerious,
  type AlertLite, type FindingRow, type InboxItem, type RunLite, type VulnDetail, type VulnGroup,
} from './model'

type Db = SupabaseClient<Database>

export interface ActiveRun {
  id: string
  siteId: string
  siteName: string
  status: string
  trigger: string
  items: Array<{ name: string; from_version: string | null; to_version: string | null }>
  createdAt: string
  startedAt: string | null
}

export type ActivityEntry =
  | { kind: 'run'; at: string; siteId: string; siteName: string; runId: string; verdict: string; items: string[]; trigger: string }
  | { kind: 'alert_opened' | 'alert_resolved'; at: string; siteId: string; siteName: string; alert: AlertLite }

export interface Operations {
  sites: Array<{ id: string; name: string; effective: string; connector_version: string | null }>
  health: ReturnType<typeof portfolioHealth>
  active: ActiveRun[]
  groups: VulnGroup[]
  inbox: InboxItem[]
  activity: ActivityEntry[]
  exposure: { openSerious: number; exposedSites: number; medianResolvedMs: number | null; resolvedCount: number }
  feedFetchedAt: string | null
  autofix: boolean
}

/** Alles voor Overzicht, Inbox en Beveiliging in één keer (RLS: alleen het eigen bureau). */
export const loadOperations = cache(loadOperationsUncached)

async function loadOperationsUncached(supabase: Db, agency: { security_autofix: boolean }, now = Date.now()): Promise<Operations> {
  const since24h = new Date(now - 86_400_000).toISOString()
  const [sitesQ, activeQ, findingsQ, alertsQ, doneQ, recentAlertsQ, resolvedQ, feedQ] = await Promise.all([
    supabase.from('sites').select('id, name, status, connection_status, last_heartbeat_at, connector_version').order('name'),
    supabase.from('update_runs').select('id, site_id, status, trigger, items, created_at, started_at').neq('status', 'done').order('created_at'),
    supabase.from('site_vulnerabilities')
      .select('site_id, vulnerability_id, component_type, component_slug, component_name, installed_version, fixed_version, fixable, severity, first_seen_at, autofix_run_id')
      .eq('status', 'open'),
    supabase.from('alerts').select('id, type, severity, params, opened_at, site_id, acknowledged_at').eq('status', 'open'),
    supabase.from('update_runs').select('id, site_id, verdict, items, finished_at, trigger').eq('status', 'done').gte('finished_at', since24h)
      .order('finished_at', { ascending: false }).limit(30),
    supabase.from('alerts').select('id, type, severity, params, opened_at, resolved_at, site_id, acknowledged_at, status')
      .neq('severity', 'info').or(`opened_at.gte.${since24h},resolved_at.gte.${since24h}`).limit(60),
    supabase.from('site_vulnerabilities').select('severity, first_seen_at, resolved_at').eq('status', 'resolved').gte('resolved_at', daysAgoIso(30, now)),
    supabase.from('vulnerability_feed_state').select('fetched_at').eq('id', 1).maybeSingle(),
  ])

  const sites = (sitesQ.data ?? []).map(s => ({ ...s, effective: effectiveStatus(s, now) }))
  const siteNames = new Map(sites.map(s => [s.id, s.name]))
  const rawFindings = (findingsQ.data ?? []) as FindingRow[]

  // Versie van de aangeboden update per oplosbaar onderdeel (dat is wat de veilige update installeert).
  const fixableSites = [...new Set(rawFindings.filter(f => f.fixable).map(f => f.site_id))]
  const { data: offered } = fixableSites.length
    ? await supabase.from('site_components').select('site_id, type, slug, latest_version').in('site_id', fixableSites).eq('update_available', true)
    : { data: [] as Array<{ site_id: string; type: string; slug: string; latest_version: string | null }> }
  const offeredBy = new Map((offered ?? []).map(c => [`${c.site_id}:${c.type}:${c.slug}`, c.latest_version]))
  const findings = rawFindings.map(f => ({ ...f, update_to: offeredBy.get(`${f.site_id}:${f.component_type}:${f.component_slug}`) ?? null }))

  const vulnIds = [...new Set(findings.map(f => f.vulnerability_id))]
  const autofixRunIds = [...new Set(findings.map(f => f.autofix_run_id).filter((x): x is string => Boolean(x)))]
  const [detailsQ, autofixRunsQ] = await Promise.all([
    vulnIds.length ? supabase.from('vulnerabilities').select('id, title, cve, cvss_score, reference_url').in('id', vulnIds) : Promise.resolve({ data: [] as VulnDetail[] }),
    autofixRunIds.length ? supabase.from('update_runs').select('id, site_id, status, verdict').in('id', autofixRunIds) : Promise.resolve({ data: [] as RunLite[] }),
  ])
  const details = new Map((detailsQ.data ?? []).map(d => [d.id, d as VulnDetail]))
  const runsById = new Map((autofixRunsQ.data ?? []).map(r => [r.id, r as RunLite]))
  const activeRunSites = new Set((activeQ.data ?? []).map(r => r.site_id))

  const groups = groupFindings(findings, details, siteNames, { autofix: agency.security_autofix, activeRunSites, runsById })
  const alerts: AlertLite[] = (alertsQ.data ?? []).map(a => ({ ...a, siteName: siteNames.get(a.site_id) ?? '—' }))
  const inbox = inboxItems(groups, alerts)

  const active: ActiveRun[] = (activeQ.data ?? []).map(r => ({
    id: r.id, siteId: r.site_id, siteName: siteNames.get(r.site_id) ?? '—', status: r.status, trigger: r.trigger,
    items: (r.items as unknown as ActiveRun['items']) ?? [], createdAt: r.created_at, startedAt: r.started_at,
  }))

  const activity: ActivityEntry[] = [
    ...(doneQ.data ?? []).map(r => ({
      kind: 'run' as const, at: r.finished_at!, siteId: r.site_id, siteName: siteNames.get(r.site_id) ?? '—', runId: r.id,
      verdict: r.verdict ?? 'error', trigger: r.trigger,
      items: ((r.items as unknown as Array<{ name: string }>) ?? []).map(i => i.name),
    })),
    ...(recentAlertsQ.data ?? []).flatMap(a => {
      const lite: AlertLite = { ...a, siteName: siteNames.get(a.site_id) ?? '—' }
      const out: ActivityEntry[] = []
      if (a.opened_at >= since24h) out.push({ kind: 'alert_opened', at: a.opened_at, siteId: a.site_id, siteName: lite.siteName, alert: lite })
      if (a.status === 'resolved' && a.resolved_at && a.resolved_at >= since24h) out.push({ kind: 'alert_resolved', at: a.resolved_at, siteId: a.site_id, siteName: lite.siteName, alert: lite })
      return out
    }),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15)

  const attention = new Set<string>()
  for (const a of alerts) if (a.severity !== 'info') attention.add(a.site_id)
  const resolvedSerious = (resolvedQ.data ?? []).filter(r => isSerious(r.severity) && r.resolved_at)
  const openSerious = findings.filter(f => isSerious(f.severity))

  return {
    sites: sites.map(s => ({ id: s.id, name: s.name, effective: s.effective, connector_version: s.connector_version })),
    health: portfolioHealth(sites, attention),
    active,
    groups,
    inbox,
    activity,
    exposure: {
      openSerious: new Set(openSerious.map(f => f.vulnerability_id)).size,
      exposedSites: new Set(findings.map(f => f.site_id)).size,
      medianResolvedMs: median(resolvedSerious.map(r => Date.parse(r.resolved_at!) - Date.parse(r.first_seen_at))),
      resolvedCount: resolvedSerious.length,
    },
    feedFetchedAt: feedQ.data?.fetched_at ?? null,
    autofix: agency.security_autofix,
  }
}
