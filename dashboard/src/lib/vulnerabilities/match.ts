import { compareVersions, isAffected, type VersionRange } from './version'

export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type SoftwareType = 'core' | 'plugin' | 'theme'

/** Eén kwetsbaarheid voor één stuk software, zoals Verploy hem opslaat (tabel public.vulnerabilities). */
export interface VulnerabilityRecord {
  id: string
  software_type: SoftwareType
  slug: string
  name: string
  title: string
  affected: VersionRange[]
  patched_versions: string[]
  severity: Severity
  cvss_score: number | null
  cve: string | null
  reference_url: string | null
  published_at: string | null
  source_updated_at: string | null
  mitre: boolean
}

/** Onderdeel van een site (tabel public.site_components). */
export interface SiteComponent {
  type: 'core' | 'plugin' | 'theme'
  slug: string
  name: string
  version: string | null
  latest_version: string | null
  update_available: boolean
}

export interface Finding {
  vulnerability_id: string
  type: SoftwareType
  slug: string
  name: string
  installed_version: string
  fixed_version: string | null
  severity: Severity
  /** Via de gewone WordPress-update te verhelpen: er staat een update klaar die niet meer kwetsbaar is. */
  fixable: boolean
}

// WordPress.org-slugs die niet uit het pad van de plugin volgen.
const SINGLE_FILE_SLUGS: Record<string, string> = { 'hello.php': 'hello-dolly' }

/**
 * Slug zoals Wordfence (= WordPress.org) hem gebruikt.
 *  plugin "akismet/akismet.php" → "akismet"; "hello.php" → "hello-dolly"; thema = mapnaam; core = "wordpress".
 */
export function feedSlug(c: Pick<SiteComponent, 'type' | 'slug'>): string {
  if (c.type === 'core') return 'wordpress'
  if (c.type === 'theme') return c.slug.toLowerCase()
  const slash = c.slug.indexOf('/')
  if (slash > 0) return c.slug.slice(0, slash).toLowerCase()
  return SINGLE_FILE_SLUGS[c.slug.toLowerCase()] ?? c.slug.replace(/\.php$/i, '').toLowerCase()
}

/** CVSS-beoordeling → ernst. Zonder CVSS: op basis van de score, anders "medium" (onbekend = niet negeren). */
export function severityOf(rating: string | null | undefined, score: number | null | undefined): Severity {
  const r = (rating ?? '').toLowerCase()
  if (r === 'critical' || r === 'high' || r === 'medium' || r === 'low') return r
  if (typeof score === 'number') {
    if (score >= 9) return 'critical'
    if (score >= 7) return 'high'
    if (score >= 4) return 'medium'
    if (score > 0) return 'low'
  }
  return 'medium'
}

/** Laagste gepatchte versie die hoger is dan de geïnstalleerde en zelf niet kwetsbaar is. */
export function fixedVersion(installed: string, rec: Pick<VulnerabilityRecord, 'patched_versions' | 'affected'>): string | null {
  const candidates = rec.patched_versions
    .filter(v => compareVersions(v, installed) > 0 && !isAffected(v, rec.affected))
    .sort(compareVersions)
  return candidates[0] ?? null
}

export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 }

/**
 * Welke kwetsbaarheden raken deze site? `bySlug` = records per "type:slug" (feedSlug).
 * Onderdelen zonder bekende versie slaan we over: dan kunnen we niets zeker zeggen.
 */
export function matchComponents(components: SiteComponent[], bySlug: Map<string, VulnerabilityRecord[]>): Finding[] {
  const out: Finding[] = []
  for (const c of components) {
    if (!c.version) continue
    const slug = feedSlug(c)
    for (const rec of bySlug.get(`${c.type}:${slug}`) ?? []) {
      if (!isAffected(c.version, rec.affected)) continue
      const fixed = fixedVersion(c.version, rec)
      const latest = c.update_available ? c.latest_version : null
      const fixable = latest !== null && compareVersions(latest, c.version) > 0 && !isAffected(latest, rec.affected)
        && (fixed === null || compareVersions(latest, fixed) >= 0)
      out.push({
        vulnerability_id: rec.id, type: c.type, slug: c.slug, name: c.name, installed_version: c.version,
        fixed_version: fixed, severity: rec.severity, fixable,
      })
    }
  }
  return out.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.name.localeCompare(b.name))
}

// ── Feed (Wordfence Intelligence v3, production) ──────────────────────────────

interface FeedAffected { from_version?: unknown; from_inclusive?: unknown; to_version?: unknown; to_inclusive?: unknown }
interface FeedSoftware { type?: unknown; name?: unknown; slug?: unknown; affected_versions?: unknown; patched_versions?: unknown }
export interface FeedRecord {
  id?: unknown; title?: unknown; software?: unknown; informational?: unknown; references?: unknown
  cvss?: { score?: unknown; rating?: unknown } | null; cve?: unknown; published?: unknown; updated?: unknown
  copyrights?: Record<string, unknown> | null
}

const s = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '')
const feedDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.replace(' ', 'T')}Z` : null)
const cleanVersion = (v: unknown) => (typeof v === 'string' && /^[0-9A-Za-z.*+_-]{1,40}$/.test(v) ? v : null)

/**
 * Zet één feedrecord om naar rijen (één per getroffen stuk software). Informatieve meldingen
 * (vrijwel geen impact) en onleesbare records slaan we over.
 */
export function normalizeFeedRecord(r: FeedRecord): VulnerabilityRecord[] {
  if (typeof r.id !== 'string' || r.informational === true || !Array.isArray(r.software)) return []
  const score = typeof r.cvss?.score === 'number' ? r.cvss.score : null
  const severity = severityOf(typeof r.cvss?.rating === 'string' ? r.cvss.rating : null, score)
  const refs = Array.isArray(r.references) ? r.references.filter((x): x is string => typeof x === 'string' && /^https?:\/\//.test(x)) : []
  const reference = refs.find(u => u.includes('wordfence.com')) ?? refs[0] ?? null
  const out: VulnerabilityRecord[] = []
  for (const sw of r.software as FeedSoftware[]) {
    const type = sw.type
    if (type !== 'core' && type !== 'plugin' && type !== 'theme') continue
    const slug = s(sw.slug, 200).toLowerCase()
    if (!slug) continue
    const affected: VersionRange[] = []
    if (sw.affected_versions && typeof sw.affected_versions === 'object') {
      for (const a of Object.values(sw.affected_versions as Record<string, FeedAffected>)) {
        const from = cleanVersion(a?.from_version)
        const to = cleanVersion(a?.to_version)
        if (!from || !to) continue
        affected.push({ from, fromInclusive: a.from_inclusive === true, to, toInclusive: a.to_inclusive === true })
      }
    }
    if (affected.length === 0) continue
    const patched = Array.isArray(sw.patched_versions) ? sw.patched_versions.map(cleanVersion).filter((v): v is string => v !== null && v !== '*') : []
    out.push({
      id: r.id, software_type: type, slug, name: s(sw.name, 200) || slug, title: s(r.title, 500) || slug,
      affected, patched_versions: patched, severity, cvss_score: score,
      cve: typeof r.cve === 'string' && /^CVE-\d{4}-\d+$/.test(r.cve) ? r.cve : null,
      reference_url: reference, published_at: feedDate(r.published), source_updated_at: feedDate(r.updated),
      mitre: Boolean(r.copyrights && typeof r.copyrights === 'object' && 'mitre' in r.copyrights),
    })
  }
  return out
}
