/**
 * Beoordeling per onderdeel binnen een veilige update ("fail isolated where possible").
 *
 * Een run is een organisatorische eenheid; de technische beoordeling gebeurt per onderdeel. Faalt één
 * onderdeel op een manier die de testkopie aantoonbaar niet heeft geraakt, dan gaan de overige onderdelen
 * door (en worden ze samen getest). De hele run stopt alleen als dat niet meer aan te tonen is: een crash,
 * een half uitgevoerde update, of gezakte tests die niet aan één onderdeel toe te wijzen zijn.
 *
 * Gedeeld door de worker (beslissingen) en het dashboard (uitleg). Puur: geen I/O.
 */

export interface RunItem {
  type: string
  slug: string
  name: string
  from_version: string | null
  to_version: string | null
  /** Uitkomst op de testkopie (status van de connector, of `skipped_dependency` / `crashed`). */
  staging?: string
  /** Uitkomst op de live site. */
  production?: string
  package_file?: string
}

export const SKIPPED_DEPENDENCY = 'skipped_dependency'
const OK = new Set(['updated', 'already_current'])

/**
 * Statussen waarbij de connector de update weigerde vóórdat er iets aan het onderdeel veranderde
 * (geen update aangeboden, geen of ongeldig pakket, download mislukt, …). De testkopie is dan voor dit
 * onderdeel gelijk aan de live site, dus de tests van de overige onderdelen blijven geldig.
 */
export const ISOLATED_FAILURES = new Set([
  'no_update_available', 'no_package', 'version_changed', 'download_failed', 'not_a_zip', 'store_failed',
  'connector_outdated', 'not_installed', 'unsupported_type',
])

export const stagingOk = (i: RunItem) => OK.has(i.staging ?? '')
export const productionOk = (i: RunItem) => OK.has(i.production ?? '')

/**
 * Mocht de rest doorgaan na deze mislukking? Ja bij een weigering vooraf, en bij een mislukte update
 * waarna de oude versie nog aantoonbaar op zijn plek staat (WordPress zet een mislukte update terug;
 * de sitebrede tests daarna bewaken de rest). Nee bij een crash of een onbekende/gewijzigde versie.
 */
export function isolatedFailure(status: string, from: string | null | undefined, now: string | null | undefined): boolean {
  if (ISOLATED_FAILURES.has(status)) return true
  return status === 'update_failed' && Boolean(from) && from === now
}

const dir = (i: RunItem) => i.slug.split('/')[0]!.toLowerCase()
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const WOO = /woocommerce|\bwoo\b/

/** Hangt `b` (vermoedelijk) af van `a`? Liever te voorzichtig dan een half geteste combinatie live. */
export function dependsOn(b: RunItem, a: RunItem): boolean {
  if (a === b || (a.type === b.type && a.slug === b.slug) || a.type === 'core') return false
  const da = dir(a)
  const db = dir(b)
  if (da === db) return false
  // Uitbreiding met dezelfde basisnaam: elementor → elementor-pro, woocommerce → woocommerce-subscriptions, thema → thema-child.
  if (db.startsWith(`${da}-`)) return true
  // "Redirection for Contact Form 7" hoort bij "Contact Form 7".
  const na = norm(a.name)
  if (na.length >= 6 && ` ${norm(b.name)} `.includes(` ${na} `)) return true
  // WooCommerce-extensies van andere makers.
  if (da === 'woocommerce') return WOO.test(db) || WOO.test(norm(b.name))
  return false
}

/** Alle onderdelen die (direct of via een ander) van `failed` afhangen. */
export function dependentsOf(failed: RunItem, items: RunItem[]): RunItem[] {
  const out: RunItem[] = []
  const queue = [failed]
  while (queue.length) {
    const a = queue.shift()!
    for (const b of items) {
      if (b !== failed && !out.includes(b) && dependsOn(b, a)) { out.push(b); queue.push(b) }
    }
  }
  return out
}

/** Volgorde waarin basis-onderdelen vóór hun uitbreidingen komen (stabiel; kringen blijven in de oude volgorde). */
export function dependencyOrder<T extends RunItem>(items: T[]): T[] {
  const out: T[] = []
  const left = [...items]
  while (left.length) {
    const i = left.findIndex(b => !left.some(a => a !== b && dependsOn(b, a)))
    out.push(...left.splice(i === -1 ? 0 : i, 1))
  }
  return out
}

export type ItemOutcome =
  | 'live'               // bijgewerkt, getest en live gecontroleerd
  | 'current'            // stond al op de nieuwste versie
  | 'attention'          // kon niet worden bijgewerkt; live ongewijzigd
  | 'skipped_dependent'  // overgeslagen omdat een onderdeel waarvan het afhangt niet lukte
  | 'held_back'          // wel getest, maar niet live gezet omdat de run als geheel stopte
  | 'rolled_back'        // live gezet en daarna teruggezet
  | 'pending'            // run loopt nog

export function itemOutcome(i: RunItem, run: { status: string; verdict: string | null }): ItemOutcome {
  if (i.staging === SKIPPED_DEPENDENCY) return 'skipped_dependent'
  if (i.staging && !stagingOk(i)) return 'attention'
  if (run.status !== 'done') return 'pending'
  if (run.verdict === 'deployed') return i.production === 'already_current' ? 'current' : productionOk(i) ? 'live' : 'held_back'
  if ((run.verdict === 'rolled_back' || run.verdict === 'error') && i.production) return 'rolled_back'
  return 'held_back'
}

export interface RunSummary {
  total: number
  live: RunItem[]
  attention: RunItem[]
  skipped: RunItem[]
  heldBack: RunItem[]
  rolledBack: RunItem[]
  /** Is de live site (tijdelijk) gewijzigd? */
  liveTouched: boolean
}

export function summarizeRun(items: RunItem[], run: { status: string; verdict: string | null }): RunSummary {
  const by = (o: ItemOutcome) => items.filter(i => itemOutcome(i, run) === o)
  return {
    total: items.length,
    live: [...by('live'), ...by('current')],
    attention: by('attention'),
    skipped: by('skipped_dependent'),
    heldBack: by('held_back'),
    rolledBack: by('rolled_back'),
    liveTouched: items.some(i => Boolean(i.production)),
  }
}

/** Aanbevolen vervolgactie bij een onderdeel dat niet kon worden bijgewerkt (sleutel onder runs.advice). */
export function adviceFor(status: string | undefined): 'licence' | 'retry' | 'connector' | 'filesystem' | 'dependency' | 'review' {
  switch (status) {
    case 'no_update_available': case 'no_package': return 'licence'
    case 'download_failed': case 'not_a_zip': case 'store_failed': case 'version_changed': return 'retry'
    case 'connector_outdated': return 'connector'
    case 'filesystem_not_writable': return 'filesystem'
    case SKIPPED_DEPENDENCY: return 'dependency'
    default: return 'review'
  }
}
