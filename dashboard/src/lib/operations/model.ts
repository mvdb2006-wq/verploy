import type { MessageKey, Translate } from '@/lib/i18n/core'
import { RUN_STEPS } from '@/lib/runs'
import { compareVersions } from '@/lib/vulnerabilities/version'

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
  /** Versie van de aangeboden (veilige) update, alleen bij oplosbaar; wat Verploy daadwerkelijk installeert. */
  update_to?: string | null
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
  | 'manual'      // er is een versie zonder lek, maar WordPress biedt die update niet aan (licentie, eigen updater)
  | 'no_fix'      // nog geen versie zonder lek

export interface GroupSite {
  siteId: string
  siteName: string
  type: string
  slug: string
  component: string
  installed: string
  fixed: string | null
  /** Doelversie van de veilige update (aangeboden versie), of anders de versie waarin het lek is opgelost. */
  target: string | null
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
  /** Aantal getroffen sites per status (een site met thema én plugin telt één keer). */
  counts: Record<SiteState, number>
  /** Aantal verschillende getroffen sites. */
  siteCount: number
}

const EMPTY_COUNTS = (): Record<SiteState, number> => ({ fixing: 0, awaiting: 0, scheduled: 0, blocked: 0, fixable: 0, manual: 0, no_fix: 0 })

export function siteState(f: FindingRow, opts: { autofix: boolean; activeRunSites: Set<string>; runsById: Map<string, RunLite> }): SiteState {
  if (opts.activeRunSites.has(f.site_id)) return 'fixing'
  if (!f.fixable) return f.fixed_version ? 'manual' : 'no_fix'
  if (f.autofix_run_id) {
    const run = opts.runsById.get(f.autofix_run_id)
    if (run && run.status === 'done' && run.verdict !== 'deployed') return 'blocked'
  }
  if (!isSerious(f.severity)) return 'fixable'
  return opts.autofix ? 'scheduled' : 'awaiting'
}

/** Open bevindingen gegroepeerd per kwetsbaarheid (ernstigste eerst, dan het langst open). */
/** Eén regel per site (de eerste), voor tellingen, namen en knoppen. */
export function uniqueSites<T extends { siteId: string }>(entries: T[]): T[] {
  const seen = new Set<string>()
  return entries.filter(e => (seen.has(e.siteId) ? false : (seen.add(e.siteId), true)))
}

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
        component: f.component_name, firstSeen: f.first_seen_at, sites: [], counts: EMPTY_COUNTS(), siteCount: 0,
      }
      groups.set(f.vulnerability_id, g)
    }
    const state = siteState(f, opts)
    g.sites.push({
      siteId: f.site_id, siteName: siteNames.get(f.site_id) ?? '—', type: f.component_type, slug: f.component_slug,
      component: f.component_name, installed: f.installed_version, fixed: f.fixed_version, target: (f.fixable ? f.update_to : null) ?? f.fixed_version, state, firstSeen: f.first_seen_at,
      runId: f.autofix_run_id,
    })
    if (f.first_seen_at < g.firstSeen) g.firstSeen = f.first_seen_at
    if (SEVERITY_RANK[f.severity as Severity] > SEVERITY_RANK[g.severity]) g.severity = f.severity as Severity
  }
  for (const g of groups.values()) {
    for (const e of uniqueSites(g.sites.map(e => ({ ...e, siteId: `${e.state}:${e.siteId}` })))) g.counts[e.state]++
    g.siteCount = uniqueSites(g.sites).length
  }
  return [...groups.values()]
    .map(g => ({ ...g, sites: g.sites.sort((a, b) => a.siteName.localeCompare(b.siteName) || a.slug.localeCompare(b.slug)) }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.firstSeen.localeCompare(b.firstSeen))
}

/**
 * Eén lek-punt in de inbox: één onderdeel met dezelfde vervolgactie, over alle sites heen. Drie lekken in
 * Avada Builder op dezelfde site zijn één handeling (bijwerken), dus één punt — niet drie.
 */
export interface VulnInboxItem {
  kind: 'approve' | 'manual' | 'no_fix' | 'blocked_fix'
  key: string
  severity: Severity
  since: string
  component: string
  componentType: string
  componentSlug: string
  sites: Array<{ siteId: string; siteName: string; runId: string | null }>
  /** Aantal verschillende lekken dat deze actie oplost (of dat open blijft). */
  vulnCount: number
  vulnIds: string[]
  /** Doelversie (hoogste van de betrokken lekken), bij bijwerken. */
  target: string | null
}

/** Punten in de inbox: beslissingen (lekken) en problemen (meldingen), ernstigste en oudste eerst. */
export type InboxItem = VulnInboxItem | { kind: 'alert'; key: string; severity: Severity; since: string; alert: AlertLite }

export interface AlertLite { id: string; type: string; severity: string; params: unknown; opened_at: string; site_id: string; siteName: string; acknowledged_at: string | null }

const alertSeverity = (s: string): Severity => (s === 'critical' ? 'critical' : s === 'warning' ? 'high' : 'low')
const KIND: Partial<Record<SiteState, VulnInboxItem['kind']>> = { awaiting: 'approve', manual: 'manual', no_fix: 'no_fix', blocked: 'blocked_fix' }

export function inboxItems(groups: VulnGroup[], alerts: AlertLite[]): InboxItem[] {
  const byAction = new Map<string, VulnInboxItem>()
  for (const g of groups) {
    if (!isSerious(g.severity)) continue
    for (const e of g.sites) {
      const kind = KIND[e.state]
      if (!kind) continue
      const key = `${kind}:${e.type}:${e.slug}`
      let item = byAction.get(key)
      if (!item) {
        item = { kind, key, severity: g.severity, since: e.firstSeen, component: e.component, componentType: e.type, componentSlug: e.slug,
          sites: [], vulnCount: 0, vulnIds: [], target: null }
        byAction.set(key, item)
      }
      if (!item.sites.some(s => s.siteId === e.siteId)) item.sites.push({ siteId: e.siteId, siteName: e.siteName, runId: e.runId })
      if (!item.vulnIds.includes(g.id)) { item.vulnIds.push(g.id); item.vulnCount++ }
      if (SEVERITY_RANK[g.severity] > SEVERITY_RANK[item.severity]) item.severity = g.severity
      if (e.firstSeen < item.since) item.since = e.firstSeen
      if (e.target && (!item.target || compareVersions(e.target, item.target) > 0)) item.target = e.target
    }
  }
  const items: InboxItem[] = [...byAction.values()].map(i => ({ ...i, sites: i.sites.sort((a, b) => a.siteName.localeCompare(b.siteName)) }))
  // Lekken staan al hierboven, per kwetsbaarheid; bevestigde meldingen tellen niet meer mee.
  for (const a of alerts) {
    if (a.type === 'vulnerability' || a.acknowledged_at || a.severity === 'info') continue
    items.push({ kind: 'alert', key: `alert:${a.id}`, severity: alertSeverity(a.severity), since: a.opened_at, alert: a })
  }
  return items.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.since.localeCompare(b.since))
}


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
  const attention = sites.filter(s => s.effective === 'online' && attentionSiteIds.has(s.id)).length
  return { total, healthy, attention, offline, pending }
}
