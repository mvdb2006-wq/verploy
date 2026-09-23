/**
 * Domeinverloopdatum via RDAP (RFC 9082/9083), met de IANA-bootstrap (RFC 9224)
 * om de juiste registry te vinden. Sommige registries (zoals SIDN voor .nl)
 * publiceren geen verloopdatum; dan is het resultaat `not_published`.
 */
export type DomainResult =
  | { expiresAt: string; error: null }
  | { expiresAt: null; error: 'not_published' | 'lookup_failed' }

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json'
let bootstrapCache: { at: number; services: Array<[string[], string[]]> } | null = null

export function resetBootstrapCache(): void {
  bootstrapCache = null
}

async function bootstrap(fetchImpl: Fetch): Promise<Array<[string[], string[]]>> {
  if (bootstrapCache && Date.now() - bootstrapCache.at < 24 * 3600_000) return bootstrapCache.services
  const res = await fetchImpl(BOOTSTRAP_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`bootstrap ${res.status}`)
  const json = (await res.json()) as { services: Array<[string[], string[]]> }
  bootstrapCache = { at: Date.now(), services: json.services }
  return json.services
}

/** Basis-URL van de RDAP-server voor een TLD (https heeft voorkeur). */
export function rdapBaseFor(tld: string, services: Array<[string[], string[]]>): string | null {
  const entry = services.find(([tlds]) => tlds.includes(tld.toLowerCase()))
  if (!entry) return null
  const urls = entry[1]
  const url = urls.find(u => u.startsWith('https://')) ?? urls[0]
  return url ? (url.endsWith('/') ? url : `${url}/`) : null
}

/** Haalt de 'expiration'-gebeurtenis uit een RDAP-domeinobject. */
export function parseExpiration(obj: unknown): string | null {
  const events = (obj as { events?: Array<{ eventAction?: string; eventDate?: string }> })?.events
  const exp = events?.find(e => e.eventAction === 'expiration')?.eventDate
  if (!exp) return null
  const d = new Date(exp)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Kandidaat-domeinnamen: eerst de laatste twee labels, daarna drie (voor bijv. co.uk). */
export function registrableCandidates(hostname: string): string[] {
  const labels = hostname.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean)
  if (labels.length < 2 || labels.every(l => /^\d+$/.test(l))) return []
  const out = [labels.slice(-2).join('.')]
  if (labels.length >= 3) out.push(labels.slice(-3).join('.'))
  return out
}

export async function lookupDomainExpiry(siteUrl: string, fetchImpl: Fetch = fetch): Promise<DomainResult> {
  const host = new URL(siteUrl).hostname
  const candidates = registrableCandidates(host)
  if (candidates.length === 0) return { expiresAt: null, error: 'lookup_failed' }
  try {
    const base = rdapBaseFor(candidates[0]!.split('.').pop()!, await bootstrap(fetchImpl))
    if (!base) return { expiresAt: null, error: 'lookup_failed' }
    for (const domain of candidates) {
      const res = await fetchImpl(`${base}domain/${encodeURIComponent(domain)}`, {
        headers: { accept: 'application/rdap+json, application/json' },
        signal: AbortSignal.timeout(10_000),
        redirect: 'follow',
      })
      if (res.status === 404) continue
      if (!res.ok) return { expiresAt: null, error: 'lookup_failed' }
      const expiresAt = parseExpiration(await res.json())
      return expiresAt ? { expiresAt, error: null } : { expiresAt: null, error: 'not_published' }
    }
    return { expiresAt: null, error: 'lookup_failed' }
  } catch {
    return { expiresAt: null, error: 'lookup_failed' }
  }
}
