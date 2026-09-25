/**
 * Geplande veilige updates: wanneer, en welke updates Verploy zelf mag doen.
 *
 * Het bureau kiest alleen Aan/Uit, een moment en eventueel "eens per week". Al het andere beslist
 * Verploy hier, per update:
 *   • auto        gewone update (patch/minor, WordPress-onderhoudsrelease): testen op een kopie, dan live;
 *   • approval    grote versiesprong (2.x → 3.x), WordPress-hoofdversie, of een versie die elders op
 *                 meerdere sites misging (update_intel): één vraag in de inbox;
 *   • held        al eens tegengehouden door deze update zelf (of licentie/pakket ontbreekt): niet opnieuw;
 *                 de melding van die run staat al in de inbox;
 *   • retry_alone tegengehouden in een run met meerdere updates, zonder dat vaststaat welke het was:
 *                 de volgende keer alleen, zodat blijkt of deze update het probleem is.
 * Lekken gaan voor. Puur (geen I/O), gedeeld door worker en tests.
 */
import { itemOutcome, type ItemOutcome, type RunItem } from '@/lib/run-items'
import { intelKey, intelVerdict, type Intel } from '@/lib/updates/intel'

export type UpdateWindow = 'night' | 'morning' | 'evening'
export type Frequency = 'daily' | 'weekly'

/** Lokale uren [van, tot) per moment. */
export const WINDOWS: Record<UpdateWindow, readonly [number, number]> = { night: [1, 5], morning: [6, 8], evening: [20, 23] }
export const UPDATE_WINDOWS = Object.keys(WINDOWS) as UpdateWindow[]
export const FREQUENCIES: Frequency[] = ['daily', 'weekly']

/** Het connector-onderdeel zelf: altijd automatisch (wordt net zo getest). */
export const CONNECTOR_SLUG = 'verploy-connector/verploy-connector.php'
/** Hoogstens zoveel onderdelen per run (zelfde grens als de database). */
export const MAX_ITEMS = 20

export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Uur (0–23) op dit moment in de tijdzone van het bureau. */
export function localHour(now: Date, tz: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: validTimezone(tz) ? tz : 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' }).format(now)
  return Number(h)
}

export function inWindow(now: Date, tz: string, window: UpdateWindow): boolean {
  const [from, to] = WINDOWS[window] ?? WINDOWS.night
  const h = localHour(now, tz)
  return h >= from && h < to
}

/** Is het nu tijd voor de geplande update van deze site? Eén keer per venster (dag) of per week. */
export function isDue(o: { now: Date; timezone: string; window: UpdateWindow; frequency: Frequency; lastScheduledAt: string | null }): boolean {
  if (!inWindow(o.now, o.timezone, o.window)) return false
  if (!o.lastScheduledAt) return true
  const since = o.now.getTime() - Date.parse(o.lastScheduledAt)
  const hours = 3_600_000
  return o.frequency === 'weekly' ? since >= 6.5 * 24 * hours : since >= 12 * hours
}

// ── Versies ───────────────────────────────────────────────────────────────────

const parts = (v: string | null | undefined): number[] | null => {
  const m = (v ?? '').trim().match(/^\d+(\.\d+)*/)
  return m ? m[0].split('.').map(Number) : null
}

export type ApprovalReason = 'major' | 'core_major' | 'unknown_version' | 'risky'

/** Moet een mens eerst akkoord geven voor deze versiesprong? null = nee. */
export function approvalReason(c: { type: string; slug: string; version: string | null; latest_version: string | null }): ApprovalReason | null {
  if (c.slug === CONNECTOR_SLUG) return null
  const from = parts(c.version)
  const to = parts(c.latest_version)
  if (!from || !to) return 'unknown_version'
  if (c.type === 'core') {
    // WordPress: 7.1 → 7.2 is een hoofdversie; 7.1.2 → 7.1.3 een onderhouds-/beveiligingsrelease.
    return to[0]! !== from[0]! || (to[1] ?? 0) !== (from[1] ?? 0) ? 'core_major' : null
  }
  return to[0]! > from[0]! ? 'major' : null
}

// ── Beslissing per update ─────────────────────────────────────────────────────

export interface Component { type: string; slug: string; name: string; version: string | null; latest_version: string | null }
export interface PastRun { status: string; verdict: string | null; items: RunItem[] }

export type Decision =
  | { kind: 'auto' }
  | { kind: 'approval'; why: ApprovalReason }
  | { kind: 'held'; why: 'failed' | 'attention' }
  | { kind: 'retry_alone' }

const FAILED: ItemOutcome[] = ['held_back', 'rolled_back', 'skipped_dependent']

export function decide(c: Component, past: PastRun[], intel?: Map<string, Intel>): Decision {
  const tries = past.flatMap(r => r.items
    .filter(i => i.type === c.type && i.slug === c.slug && i.to_version === c.latest_version)
    .map(i => ({ outcome: itemOutcome(i, r), alone: r.items.length === 1 })))
  if (tries.some(t => t.outcome === 'attention')) return { kind: 'held', why: 'attention' }
  if (tries.some(t => FAILED.includes(t.outcome) && t.alone)) return { kind: 'held', why: 'failed' }
  // Een grote versiesprong doet Verploy nooit zelf, ook niet als herkansing.
  const why = approvalReason(c)
  if (why) return { kind: 'approval', why }
  // Elders ging deze versie op meerdere sites mis: niet zelf doen, eerst even kijken.
  if (c.latest_version && intel && intelVerdict(intel.get(intelKey(c.type, c.slug, c.latest_version))) === 'risky') return { kind: 'approval', why: 'risky' }
  if (tries.some(t => FAILED.includes(t.outcome))) return { kind: 'retry_alone' }
  return { kind: 'auto' }
}

export interface Plan {
  /** Onderdelen voor de run van nu (leeg: niets te doen). */
  run: Array<{ type: string; slug: string }>
  /** Wacht op akkoord (één vraag in de inbox). */
  approvals: Array<{ type: string; slug: string; name: string; from_version: string | null; to_version: string | null; why: ApprovalReason }>
  held: Array<{ type: string; slug: string; why: 'failed' | 'attention' }>
  /** De run is een losse herkansing (mag vaker binnen hetzelfde venster, tot alles is uitgezocht). */
  retry: boolean
}

/**
 * Wat gaat er nu mee? Eerst alle gewone updates samen (lekken voorop). Zijn er die niet, dan één
 * eerder in een groep tegengehouden update apart, om te zien of die het probleem was.
 */
export function plan(components: Component[], past: PastRun[], vulnerable: Set<string>, intel?: Map<string, Intel>): Plan {
  const key = (c: { type: string; slug: string }) => `${c.type}:${c.slug}`
  const rank = (c: Component) => (vulnerable.has(key(c)) ? 0 : c.slug === CONNECTOR_SLUG ? 1 : 2)
  const sorted = [...components].filter(c => c.latest_version).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const auto: Component[] = []
  const alone: Component[] = []
  const out: Plan = { run: [], approvals: [], held: [], retry: false }
  for (const c of sorted) {
    const d = decide(c, past, intel)
    if (d.kind === 'auto') auto.push(c)
    else if (d.kind === 'retry_alone') alone.push(c)
    else if (d.kind === 'approval') out.approvals.push({ type: c.type, slug: c.slug, name: c.name, from_version: c.version, to_version: c.latest_version, why: d.why })
    else out.held.push({ type: c.type, slug: c.slug, why: d.why })
  }
  const pick = auto.length ? auto.slice(0, MAX_ITEMS) : alone.slice(0, 1)
  out.run = pick.map(c => ({ type: c.type, slug: c.slug }))
  out.retry = auto.length === 0 && pick.length > 0
  return out
}
