/**
 * Normaliseert een site-URL tot `scheme://host[:port][/pad]` zonder trailing slash,
 * query of fragment. Host in kleine letters. Geeft null bij ongeldige invoer.
 */
export function normalizeSiteUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null
  if (u.username || u.password) return null
  const path = u.pathname.replace(/\/+$/, '')
  const port = u.port ? `:${u.port}` : ''
  return `${u.protocol}//${u.hostname.toLowerCase()}${port}${path}`
}

/** Vergelijkt twee site-URL's, waarbij http/https en `www.` gelijk tellen. */
export function sameSite(a: string, b: string): boolean {
  const strip = (x: string | null) => x?.replace(/^https?:\/\//, '').replace(/^www\./, '') ?? null
  const na = strip(normalizeSiteUrl(a))
  const nb = strip(normalizeSiteUrl(b))
  return na !== null && na === nb
}
