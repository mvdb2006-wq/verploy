/**
 * Server-side helper: stuur een update-commando direct naar een WordPress-site
 * via het Verploy REST-endpoint (/wp-json/verploy/v1/update).
 *
 * Werkt voor:
 *  - WP.org-plugins op connector 1.2.0+ (WordPress vult zelf de update-transient)
 *  - Alle plugins op connector 1.3.0+ (class-updater.php vult de Verploy-transient)
 *
 * Werkt NIET voor:
 *  - Verploy Connector zelf op 1.2.0 (geen class-updater.php → transient leeg)
 *    → gebruik semverLt() check in de aanroeper om dit geval af te vangen
 */

const PUSH_TIMEOUT_MS = 25_000 // 25 seconden — ruim onder Vercel's 30s-limiet

export interface PushUpdateResult {
  success: boolean
  log?: string
  timedOut?: boolean
}

export async function pushPluginUpdate(
  siteUrl: string,
  apiKey: string,
  pluginSlug: string,
): Promise<PushUpdateResult> {
  const base = siteUrl.replace(/\/+$/, '')
  const endpoint = `${base}/wp-json/verploy/v1/update`

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'plugin', slug: pluginSlug }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { success: false, log: `HTTP ${res.status}: ${body}` }
    }

    const data = await res.json() as {
      success?: boolean
      messages?: string[]
      message?: string
    }

    return {
      success: !!data.success,
      log: data.messages?.join('\n') ?? data.message ?? undefined,
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { success: false, timedOut: true, log: 'Verzoek verlopen (>25s).' }
    }
    return { success: false, log: String(err) }
  }
}

// ─── Semver helper ────────────────────────────────────────────────────────────

/** Geeft true als versiestring `a` strikt kleiner is dan `b`. */
export function semverLt(a: string | null | undefined, b: string): boolean {
  if (!a) return true
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na < nb) return true
    if (na > nb) return false
  }
  return false // gelijk
}

export const VERPLOY_SLUG    = 'verploy-connector/verploy-connector.php'
export const VERPLOY_LATEST  = '1.3.0'
export const JOB_RUNNER_MIN  = '1.3.0' // Eerste connector-versie met class-job-runner.php
