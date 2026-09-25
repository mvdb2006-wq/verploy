/**
 * Het sitesoverzicht: één regel per site met wat een bureau in één oogopslag wil weten, en de
 * indeling in de filters. Puur (geen I/O), zodat het met tests is vast te leggen.
 */
import { computeUptime, type OfflineAlert } from '@/lib/reports/model'
import { versionAtLeast } from '@/lib/runs'
import { MIN_CONNECTOR_FOR_LOGIN } from '@/lib/wp-login/token'
import { CONNECTOR_RELEASE } from '@/lib/connector/release'

export type SiteFilter = 'all' | 'healthy' | 'attention' | 'offline' | 'updating' | 'vulnerable' | 'connector'
export const SITE_FILTERS: SiteFilter[] = ['all', 'healthy', 'attention', 'offline', 'updating', 'vulnerable', 'connector']

export interface SiteRow {
  id: string
  name: string
  url: string
  domain: string
  client: string | null
  /** online | offline | pending (niet gekoppeld) */
  status: string
  updating: boolean
  /** Uptime over de laatste 30 dagen in procenten (null = te kort gemeten). */
  uptime: number | null
  updates: number
  vulns: number
  vulnSeverity: 'critical' | 'high' | 'medium' | 'low' | null
  /** Zwaarste open melding (waarschuwing/kritiek), met aantal. */
  alert: { severity: 'warning' | 'critical'; count: number } | null
  lastRun: { id: string; verdict: string; reasonKey: string | null; at: string } | null
  filters: SiteFilter[]
  /** Met één klik inloggen in WP Admin (connector ≥ 2.5). */
  wpLogin: boolean
  /** Alleen als de connector achterloopt: geïnstalleerde en nieuwste versie. */
  connector: { installed: string; latest: string } | null
}

export interface SiteInput {
  id: string; name: string; url: string; client_name: string | null; effective: string; paired_at: string | null
  connector_version?: string | null; connection_status?: string
}

const RANK = { low: 1, medium: 2, high: 3, critical: 4 } as const

export const domainOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

export function buildSiteRows(
  sites: SiteInput[],
  data: {
    updates: Array<{ site_id: string }>
    alerts: Array<{ site_id: string; severity: string }>
    vulns: Array<{ site_id: string; severity: string }>
    activeRunSites: Set<string>
    lastRuns: Array<{ id: string; site_id: string; verdict: string | null; reason_key: string | null; finished_at: string | null }>
    offline: Array<OfflineAlert & { site_id: string }>
  },
  now = Date.now(),
  opts: { latestConnector: string } = { latestConnector: CONNECTOR_RELEASE.version },
): SiteRow[] {
  const count = <T extends { site_id: string }>(xs: T[]) => xs.reduce((m, x) => m.set(x.site_id, (m.get(x.site_id) ?? 0) + 1), new Map<string, number>())
  const updates = count(data.updates)
  const vulnCount = count(data.vulns)
  const vulnWorst = new Map<string, SiteRow['vulnSeverity']>()
  for (const v of data.vulns) {
    const s = v.severity as keyof typeof RANK
    const cur = vulnWorst.get(v.site_id)
    if (RANK[s] && (!cur || RANK[s] > RANK[cur])) vulnWorst.set(v.site_id, s)
  }
  const alerts = new Map<string, NonNullable<SiteRow['alert']>>()
  for (const a of data.alerts) {
    if (a.severity !== 'warning' && a.severity !== 'critical') continue
    const cur = alerts.get(a.site_id)
    alerts.set(a.site_id, { severity: cur?.severity === 'critical' || a.severity === 'critical' ? 'critical' : 'warning', count: (cur?.count ?? 0) + 1 })
  }
  const lastRun = new Map<string, SiteRow['lastRun']>()
  for (const r of data.lastRuns) {
    if (!r.finished_at || !r.verdict) continue
    const cur = lastRun.get(r.site_id)
    if (!cur || r.finished_at > cur.at) lastRun.set(r.site_id, { id: r.id, verdict: r.verdict, reasonKey: r.reason_key, at: r.finished_at })
  }
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const from = day(now - 29 * 86_400_000)
  const to = day(now)

  return sites.map(s => {
    const alert = alerts.get(s.id) ?? null
    const vulns = vulnCount.get(s.id) ?? 0
    const updating = data.activeRunSites.has(s.id)
    const uptime = s.paired_at
      ? computeUptime(data.offline.filter(o => o.site_id === s.id), from, to, s.paired_at, now).percent
      : null
    const filters: SiteFilter[] = ['all']
    if (s.effective === 'offline') filters.push('offline')
    else if (s.effective === 'pending' || alert) filters.push('attention')
    else filters.push('healthy')
    if (updating) filters.push('updating')
    if (vulns > 0) filters.push('vulnerable')
    const latest = opts.latestConnector
    const connector = s.connection_status === 'connected' && s.connector_version && !versionAtLeast(s.connector_version, latest.split('.').map(Number))
      ? { installed: s.connector_version, latest } : null
    if (connector) filters.push('connector')
    return {
      id: s.id, name: s.name, url: s.url, domain: domainOf(s.url), client: s.client_name, status: s.effective, updating, uptime,
      wpLogin: s.connection_status === 'connected' && versionAtLeast(s.connector_version ?? null, MIN_CONNECTOR_FOR_LOGIN), connector,
      updates: updates.get(s.id) ?? 0, vulns, vulnSeverity: vulnWorst.get(s.id) ?? null, alert, lastRun: lastRun.get(s.id) ?? null, filters,
    }
  })
}

/** Direct zoeken op naam, domein en klant (hoofdletterongevoelig, alle woorden moeten ergens voorkomen). */
export function matchesQuery(row: Pick<SiteRow, 'name' | 'domain' | 'client'>, query: string): boolean {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = `${row.name} ${row.domain} ${row.client ?? ''}`.toLowerCase()
  return words.every(w => hay.includes(w))
}
