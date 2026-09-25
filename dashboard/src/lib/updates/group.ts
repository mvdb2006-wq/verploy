/**
 * Alle beschikbare updates over alle sites, per onderdeel: "WooCommerce → 11.2.0 op 5 sites".
 * Puur, zodat het met tests is vast te leggen. Voor de knop "Veilig bijwerken op alle N sites".
 */
import { approvalReason } from '@/lib/auto-updates/policy'
import { compareVersions } from '@/lib/vulnerabilities/version'

export interface ComponentUpdate {
  site_id: string; type: string; slug: string; name: string; version: string | null; latest_version: string | null
}

export interface UpdateGroup {
  key: string
  type: string
  slug: string
  name: string
  /** Hoogste aangeboden versie. */
  target: string
  sites: Array<{ siteId: string; siteName: string; from: string | null; to: string; busy: boolean }>
  /** Grote versiesprong (of WordPress-hoofdversie) op minstens één site: eerst even kijken. */
  major: boolean
  /** Lost op minstens één site een bekend lek op. */
  security: boolean
}

export function groupUpdates(
  comps: ComponentUpdate[], siteNames: Map<string, string>, opts: { busySites?: Set<string>; vulnerable?: Set<string> } = {},
): UpdateGroup[] {
  const groups = new Map<string, UpdateGroup>()
  for (const c of comps) {
    if (!c.latest_version) continue
    const key = `${c.type}:${c.slug}`
    let g = groups.get(key)
    if (!g) {
      g = { key, type: c.type, slug: c.slug, name: c.name, target: c.latest_version, sites: [], major: false, security: false }
      groups.set(key, g)
    }
    if (compareVersions(c.latest_version, g.target) > 0) g.target = c.latest_version
    g.sites.push({ siteId: c.site_id, siteName: siteNames.get(c.site_id) ?? '—', from: c.version, to: c.latest_version, busy: opts.busySites?.has(c.site_id) ?? false })
    if (approvalReason(c)) g.major = true
    if (opts.vulnerable?.has(`${c.site_id}:${key}`)) g.security = true
  }
  for (const g of groups.values()) g.sites.sort((a, b) => a.siteName.localeCompare(b.siteName))
  // Lekken eerst, dan de meeste sites, dan op naam.
  return [...groups.values()].sort((a, b) => Number(b.security) - Number(a.security) || b.sites.length - a.sites.length || a.name.localeCompare(b.name))
}
