import type { FunctionalTargets } from './functional'
import { createHmac } from 'node:crypto'
import { signedHeaders } from '@/lib/security/signing'

/** Fout van de site die een nieuwe poging verdient (netwerk, time-out, 5xx, 429). */
export class TransientSiteError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message)
  }
}

/** Fout die niet vanzelf overgaat (401, 404, 409 …): de run kan zo niet verder. */
export class SiteRejectedError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message)
  }
}

export interface ApplyResult {
  ok: boolean
  type: string
  slug: string
  from_version: string | null
  to_version: string | null
  status: 'updated' | 'already_current' | 'update_failed' | 'not_installed' | 'no_update_available' | 'filesystem_not_writable' | 'unknown_type'
    | PackageResult['status'] | 'connector_outdated'
  log: string
}

/** Updatepakket dat de live site (met haar licentie) heeft opgehaald (plugin 2.3+). */
export interface PackageResult {
  ok: boolean
  status: 'ready' | 'no_update_available' | 'no_package' | 'version_changed' | 'download_failed' | 'not_a_zip' | 'store_failed' | 'unsupported_type'
  file?: string
  version?: string
}

export interface PageTarget { key: string; label: string; url: string }

export interface StagingProgress {
  state: 'building' | 'ready'
  url: string
  progress?: { phase: string; files_done: number; files_total: number; tables_done: number; tables_total: number }
}

export interface Diagnostics {
  fatals: { message: string; file: string; line: number; uri: string }[]
  log_tail: string[]
  environment: { wp_version: string; php_version: string; theme: string; plugins: { slug: string; name: string; version: string }[]; staging: boolean }
}

type FetchLike = typeof fetch

/**
 * Ondertekende verzoeken naar de Verploy Connector (plugin 2.1+). Gebruikt `?rest_route=`
 * zodat het werkt ongeacht de permalinkinstellingen (ook op staging, die eenvoudige permalinks heeft).
 */
export class SiteClient {
  constructor(
    private readonly siteId: string,
    private readonly secret: string,
    private readonly runId: string,
    private readonly opts: { fetch?: FetchLike; timeoutMs?: number } = {},
  ) {}

  /** Token voor de staging-kopie (cookie `verploy_staging`), zelfde formule als de plugin. */
  stagingToken(): string {
    return createHmac('sha256', this.secret).update(`staging|${this.runId}`).digest('hex')
  }

  /** Token om tijdens onderhoudsmodus productie te testen (cookie `verploy_bypass`). */
  bypassToken(): string {
    return createHmac('sha256', this.secret).update(`bypass|${this.runId}`).digest('hex')
  }

  async call<T>(baseUrl: string, route: string, body: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    const path = `/verploy/v2${route}`
    const raw = JSON.stringify({ run_id: this.runId, ...body })
    const url = `${baseUrl.replace(/\/$/, '')}/?rest_route=${encodeURIComponent(path).replace(/%2F/g, '/')}`
    const f = this.opts.fetch ?? fetch
    let res: Response
    try {
      res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'Verploy-Worker/1.0 (+https://app.verploy.com)', ...signedHeaders(this.siteId, this.secret, 'POST', path, raw) },
        body: raw,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs ?? this.opts.timeoutMs ?? 90_000),
      })
    } catch (err) {
      throw new TransientSiteError(`network: ${(err as Error).message}`, null)
    }
    const text = await res.text()
    let data: unknown = null
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    if (res.ok && data !== null) return data as T
    const code = data && typeof data === 'object' && 'code' in data ? String((data as { code: unknown }).code) : null
    const message = data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : text.slice(0, 200)
    if (res.status >= 500 || res.status === 429 || (res.ok && data === null)) {
      throw new TransientSiteError(`${route}: HTTP ${res.status} ${code ?? ''} ${message}`.trim(), res.status)
    }
    throw new SiteRejectedError(`${route}: HTTP ${res.status} ${code ?? ''} ${message}`.trim(), res.status, code)
  }

  lock(base: string, ttlSeconds = 3600) { return this.call<{ locked: true }>(base, '/run/lock', { ttl: ttlSeconds }) }
  stagingBuild(base: string) { return this.call<StagingProgress>(base, '/staging/build', {}, 120_000) }
  pages(base: string, keys: string[] | null, extraPaths: string[] = []) {
    return this.call<{ pages: PageTarget[] }>(base, '/run/pages', { keys, extra_paths: extraPaths })
  }
  apply(base: string, item: { type: string; slug: string; to_version: string | null; package_file?: string }) {
    return this.call<ApplyResult>(base, '/updates/apply', { item }, 300_000)
  }
  fetchPackage(base: string, item: { type: string; slug: string; to_version: string | null }) {
    return this.call<PackageResult>(base, '/updates/package', { item }, 360_000)
  }
  snapshot(base: string, items: { type: string; slug: string }[]) {
    return this.call<{ state: 'building' | 'ready'; phase: string }>(base, '/snapshot/create', { items }, 120_000)
  }
  maintenance(base: string, enabled: boolean, ttlSeconds = 1800) {
    return this.call<{ maintenance: boolean }>(base, '/maintenance', { enabled, ttl: ttlSeconds })
  }
  rollback(base: string) { return this.call<{ state: 'rolled_back' }>(base, '/rollback', {}, 300_000) }
  cleanup(base: string) { return this.call<{ state: 'cleaned' }>(base, '/cleanup', {}, 120_000) }
  diagnostics(base: string) { return this.call<Diagnostics>(base, '/run/diagnostics') }
  /** Formulieren en webwinkel om functioneel te testen (connector 2.4+; ouder geeft 404). */
  functional(base: string) { return this.call<FunctionalTargets>(base, '/run/functional') }
  heartbeatNow(base: string) { return this.call<{ sent: true }>(base, '/heartbeat/now') }
}
