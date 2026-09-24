import type { MessageKey, Translate } from '@/lib/i18n/core'
import { RUN_STEPS } from '@/lib/runs'

/**
 * Het "bedrijfsbeeld" van een bureau voor Overzicht, Inbox en Beveiliging: pure functies,
 * zodat de regels (wat wacht op wie, hoe lang staat een lek open) los te testen zijn.
 */

export type Severity = 'low' | 'medium' | 'high' | 'critical'
export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 }
export const isSerious = (s: string) => s === 'high' || s === 'critical'

export interface FindingRow {
  site_id: string
  vulnerability_id: string
  component_type: string
  component_slug: string
  component_name: string
  installed_version: string
  fixed_version: string | null
  fixable: boolean
  severity: string
  first_seen_at: string
  autofix_run_id: string | null
}
export interface VulnDetail { id: string; title: string; cve: string | null; cvss_score: number | null; reference_url: string | null }
export interface RunLite { id: string; site_id: string; status: string; verdict: string | null }

/** Wat er per site met een lek gebeurt. */
export type SiteState =
  | 'fixing'      // er loopt een veilige update op deze site
  | 'awaiting'    // ernstig/kritiek, oplossing klaar, wacht op goedkeuring
  | 'scheduled'   // automatisch oplossen staat aan: Verploy start zo zelf
  | 'blocked'     // automatische oplossing is tegengehouden of mislukt → nakijken
  | 'fixable'     // laag/middel met oplossing: kan, hoeft niet
  | 'no_fix'      // nog geen versie zonder lek

export interface GroupSite {
  siteId: string
  siteName: string
  type: string
  slug: string
  component: string
  installed: string
  fixed: string | null
  state: SiteState
  firstSeen: string
  runId: string | null
}

export interface VulnGroup {
  id: string
  title: string
  severity: Severity
  cve: string | null
  cvss: number | null
  url: string | null
  component: string
  firstSeen: string
  sites: GroupSite[]
  counts: Record<SiteState, number>
}

const EMPTY_COUNTS = (): Record<SiteState, number> => ({ fixing: 0, awaiting: 0, scheduled: 0, blocked: 0, fixable: 0, no_fix: 0 })

export function siteState(f: FindingRow, opts: { autofix: boolean; activeRunSites: Set<string>; runsById: Map<string, RunLite> }): SiteState {
  if (opts.activeRunSites.has(f.site_id)) return 'fixing'
  if (!f.fixable) return 'no_fix'
  if (f.autofix_run_id) {
    const run = opts.runsById.get(f.autofix_run_id)
    if (run && run.status === 'done' && run.verdict !== 'deployed') return 'blocked'
  }
  if (!isSerious(f.severity)) return 'fixable'
  return opts.autofix ? 'scheduled' : 'awaiting'
}

/** Open bevindingen gegroepeerd per kwetsbaarheid (ernstigste eerst, dan het langst open). */
export function groupFindings(
  findings: FindingRow[],
  details: Map<string, VulnDetail>,
  siteNames: Map<string, string>,
  opts: { autofix: boolean; activeRunSites: Set<string>; runsById: Map<string, RunLite> },
): VulnGroup[] {
  const groups = new Map<string, VulnGroup>()
  for (const f of findings) {
    const d = details.get(f.vulnerability_id)
    let g = groups.get(f.vulnerability_id)
    if (!g) {
      g = {
        id: f.vulnerability_id, title: d?.title ?? f.vulnerability_id, severity: f.severity as Severity,
        cve: d?.cve ?? null, cvss: d?.cvss_score ?? null, url: d?.reference_url ?? null,
        component: f.component_name, firstSeen: f.first_seen_at, sites: [], counts: EMPTY_COUNTS(),
      }
      groups.set(f.vulnerability_id, g)
    }
    const state = siteState(f, opts)
    g.sites.push({
      siteId: f.site_id, siteName: siteNames.get(f.site_id) ?? '—', type: f.component_type, slug: f.component_slug,
      component: f.component_name, installed: f.installed_version, fixed: f.fixed_version, state, firstSeen: f.first_seen_at,
      runId: f.autofix_run_id,
    })
    g.counts[state]++
    if (f.first_seen_at < g.firstSeen) g.firstSeen = f.first_seen_at
    if (SEVERITY_RANK[f.severity as Severity] > SEVERITY_RANK[g.severity]) g.severity = f.severity as Severity
  }
  return [...groups.values()]
    .map(g => ({ ...g, sites: g.sites.sort((a, b) => a.siteName.localeCompare(b.siteName)) }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.firstSeen.localeCompare(b.firstSeen))
}

/** Punten in de inbox: beslissingen (lekken) en problemen (meldingen), ernstigste en oudste eerst. */
export type InboxItem =
  | { kind: 'approve'; key: string; severity: Severity; since: string; group: VulnGroup; siteIds: string[] }
  | { kind: 'no_fix'; key: string; severity: Severity; since: string; group: VulnGroup }
  | { kind: 'blocked_fix'; key: string; severity: Severity; since: string; group: VulnGroup }
  | { kind: 'alert'; key: string; severity: Severity; since: string; alert: AlertLite }

export interface AlertLite { id: string; type: string; severity: string; params: unknown; opened_at: string; site_id: string; siteName: string; acknowledged_at: string | null }

const alertSeverity = (s: string): Severity => (s === 'critical' ? 'critical' : s === 'warning' ? 'high' : 'low')

export function inboxItems(groups: VulnGroup[], alerts: AlertLite[]): InboxItem[] {
  const items: InboxItem[] = []
  for (const g of groups) {
    if (!isSerious(g.severity)) continue
    const awaiting = g.sites.filter(s => s.state === 'awaiting')
    if (awaiting.length) {
      items.push({ kind: 'approve', key: `approve:${g.id}`, severity: g.severity, since: minIso(awaiting.map(s => s.firstSeen)), group: g, siteIds: awaiting.map(s => s.siteId) })
    }
    const blocked = g.sites.filter(s => s.state === 'blocked')
    if (blocked.length) items.push({ kind: 'blocked_fix', key: `blocked:${g.id}`, severity: g.severity, since: minIso(blocked.map(s => s.firstSeen)), group: g })
    const noFix = g.sites.filter(s => s.state === 'no_fix')
    if (noFix.length) items.push({ kind: 'no_fix', key: `nofix:${g.id}`, severity: g.severity, since: minIso(noFix.map(s => s.firstSeen)), group: g })
  }
  // Lekken staan al hierboven, per kwetsbaarheid; bevestigde meldingen tellen niet meer mee.
  for (const a of alerts) {
    if (a.type === 'vulnerability' || a.acknowledged_at || a.severity === 'info') continue
    items.push({ kind: 'alert', key: `alert:${a.id}`, severity: alertSeverity(a.severity), since: a.opened_at, alert: a })
  }
  return items.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.since.localeCompare(b.since))
}

const minIso = (xs: string[]) => xs.reduce((m, x) => (x < m ? x : m))

/** Voortgang van een run: stap n van m (0..1). */
export function runProgress(status: string): number {
  if (status === 'queued') return 0
  if (status === 'done') return 1
  const i = RUN_STEPS.indexOf(status as (typeof RUN_STEPS)[number])
  return i < 0 ? 0 : (i + 0.5) / RUN_STEPS.length
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

/** "2 d 3 u", "3 u 12 min", "8 min" — de twee grootste eenheden. */
export function formatDuration(ms: number, t: Translate): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  const part = (key: 'd' | 'h' | 'm', n: number) => t(`ops.dur.${key}` as MessageKey, { n })
  if (d > 0) return h > 0 ? `${part('d', d)} ${part('h', h)}` : part('d', d)
  if (h > 0) return m > 0 ? `${part('h', h)} ${part('m', m)}` : part('h', h)
  return part('m', m)
}

/** Gezond = gekoppeld, online en geen open waarschuwing of kritieke melding. */
export function portfolioHealth(sites: { id: string; effective: string }[], attentionSiteIds: Set<string>) {
  const total = sites.length
  const offline = sites.filter(s => s.effective === 'offline').length
  const pending = sites.filter(s => s.effective === 'pending').length
  const healthy = sites.filter(s => s.effective === 'online' && !attentionSiteIds.has(s.id)).length
  return { total, healthy, offline, pending }
}
