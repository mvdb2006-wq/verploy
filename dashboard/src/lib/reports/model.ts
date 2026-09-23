/** Alles wat een rapport toont. Wordt door de worker verzameld en door render.ts als HTML/PDF opgemaakt. */
export interface ReportData {
  agency: { name: string; color: string; logoDataUri: string | null; sender: string }
  site: { name: string; url: string; client: string | null }
  period: { start: string; end: string }   // YYYY-MM-DD, inclusief
  generatedAt: string
  uptime: { percent: number | null; downtimeMinutes: number; incidents: { start: string; minutes: number | null }[] }
  runs: { date: string; verdict: 'deployed' | 'blocked' | 'rolled_back'; items: { name: string; from: string | null; to: string | null }[]; diagnosis: string | null }[]
  health: {
    wp: string | null
    php: string | null
    phpEol: { date: string; past: boolean } | null
    https: boolean
    sslValidUntil: string | null
    sslError: string | null
    domainUntil: string | null
    memoryMb: number | null
    diskFreeMb: number | null
    pendingUpdates: number
  }
  attention: { title: string; body: string; severity: 'warning' | 'critical' }[]
}

export interface OfflineAlert { opened_at: string; resolved_at: string | null; since: string | null }

/**
 * Beschikbaarheid in de periode, op basis van offline-meldingen (heartbeat elke 15 min; een
 * melding opent na 45 min stilte, het begin is de laatste heartbeat). Gemeten vanaf de koppeling.
 */
export function computeUptime(alerts: OfflineAlert[], periodStart: string, periodEnd: string, monitoredFrom: string | null, now = Date.now()):
  ReportData['uptime'] {
  const start = Math.max(Date.parse(`${periodStart}T00:00:00Z`), monitoredFrom ? Date.parse(monitoredFrom) : 0)
  const end = Math.min(Date.parse(`${periodEnd}T00:00:00Z`) + 86_400_000, now)
  if (!(end > start)) return { percent: null, downtimeMinutes: 0, incidents: [] }
  let down = 0
  const incidents: ReportData['uptime']['incidents'] = []
  for (const a of alerts) {
    const from = Date.parse(a.since ?? a.opened_at)
    const to = a.resolved_at ? Date.parse(a.resolved_at) : now
    const s = Math.max(from, start)
    const e = Math.min(to, end)
    if (e <= s) continue
    down += e - s
    incidents.push({ start: new Date(from).toISOString(), minutes: a.resolved_at ? Math.round((to - from) / 60_000) : null })
  }
  incidents.sort((x, y) => x.start.localeCompare(y.start))
  return { percent: Math.max(0, Math.min(100, 100 * (1 - down / (end - start)))), downtimeMinutes: Math.round(down / 60_000), incidents }
}
