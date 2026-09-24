import { z } from 'zod'

/** Heartbeat van Verploy Connector ≥ 2.0 (schema 2). */
const version = z.string().max(40).regex(/^[0-9A-Za-z.+_-]+$/)
const component = z.object({
  name: z.string().max(200),
  version: version.nullable(),
  active: z.boolean(),
  update_available: z.boolean(),
  update_version: version.nullable(),
})

export const heartbeatSchema = z.object({
  schema: z.literal(2),
  collected_at: z.iso.datetime({ offset: true }),
  connector_version: version,
  site: z.object({
    url: z.string().max(500),
    name: z.string().max(200),
    locale: z.string().max(20),
    timezone: z.string().max(64),
    multisite: z.boolean(),
  }),
  server: z.object({
    php_version: version,
    memory_limit: z.string().max(20),
    memory_peak_bytes: z.number().int().nonnegative().nullable(),
    max_execution_time: z.number().int().nullable(),
    disk_free_bytes: z.number().nonnegative().nullable(),
    mysql_version: z.string().max(80).nullable(),
    db_size_bytes: z.number().nonnegative().nullable(),
  }),
  wordpress: z.object({
    version,
    update_available: z.boolean(),
    update_version: version.nullable(),
  }),
  plugins: z.array(component.extend({ file: z.string().min(1).max(255) })).max(1000),
  themes: z.array(component.extend({ slug: z.string().min(1).max(255) })).max(200),
})

export type HeartbeatPayload = z.infer<typeof heartbeatSchema>

export const connectSchema = z.object({
  code: z.string().min(8).max(20),
  site_url: z.string().min(4).max(500),
  connector_version: version,
})

/** "256M" → 256, "1G" → 1024, "-1" (onbeperkt) → null. */
export function parseMemoryLimitMb(limit: string): number | null {
  const m = /^\s*(-?\d+)\s*([KMG]?)\s*$/i.exec(limit)
  if (!m) return null
  const n = Number(m[1])
  if (n < 0) return null
  const unit = (m[2] ?? '').toUpperCase()
  if (unit === 'G') return n * 1024
  if (unit === 'K') return Math.round(n / 1024)
  if (unit === 'M') return n
  return Math.round(n / (1024 * 1024)) // bytes
}

const mb = (bytes: number | null) => (bytes === null ? null : Math.round(bytes / (1024 * 1024)))

export interface HeartbeatRows {
  snapshot: Record<string, unknown>
  components: Array<{ type: 'plugin' | 'theme' | 'core'; slug: string; name: string; version: string | null; latest_version: string | null; update_available: boolean; active: boolean }>
}

/**
 * Is `latest` echt nieuwer dan `installed`? WordPress kan een verouderde update-melding bewaren
 * (bijv. na handmatig een nieuwere versie uploaden), en dan zou een "update" een downgrade zijn.
 * Numerieke delen worden vergeleken; zijn die gelijk (bijv. 1.0-beta ↔ 1.0), dan volgen we WordPress.
 */
export function isNewerVersion(latest: string, installed: string | null): boolean {
  if (!installed) return true
  const nums = (v: string) => (/^[0-9]+(?:\.[0-9]+)*/.exec(v)?.[0] ?? '').split('.').filter(Boolean).map(Number)
  const a = nums(latest)
  const b = nums(installed)
  if (a.length === 0 || b.length === 0) return latest !== installed
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return latest !== installed
}

/** Updatemelding alleen overnemen als de aangeboden versie nieuwer is dan de geïnstalleerde. */
function offer(reported: boolean, latest: string | null, installed: string | null): { latest_version: string | null; update_available: boolean } {
  if (!reported || !latest || !isNewerVersion(latest, installed)) return { latest_version: null, update_available: false }
  return { latest_version: latest, update_available: true }
}

export function toRows(p: HeartbeatPayload): HeartbeatRows {
  return {
    snapshot: {
      captured_at: p.collected_at,
      connector_version: p.connector_version,
      wp_version: p.wordpress.version,
      php_version: p.server.php_version,
      memory_limit_mb: parseMemoryLimitMb(p.server.memory_limit),
      memory_peak_mb: mb(p.server.memory_peak_bytes),
      disk_free_mb: mb(p.server.disk_free_bytes),
      db_size_mb: p.server.db_size_bytes === null ? null : Math.round((p.server.db_size_bytes / (1024 * 1024)) * 100) / 100,
      raw: { site: p.site, server: p.server, wordpress: p.wordpress },
    },
    components: [
      { type: 'core', slug: 'wordpress', name: 'WordPress', version: p.wordpress.version,
        ...offer(p.wordpress.update_available, p.wordpress.update_version, p.wordpress.version), active: true },
      ...p.plugins.map(pl => ({ type: 'plugin' as const, slug: pl.file, name: pl.name, version: pl.version,
        ...offer(pl.update_available, pl.update_version, pl.version), active: pl.active })),
      ...p.themes.map(th => ({ type: 'theme' as const, slug: th.slug, name: th.name, version: th.version,
        ...offer(th.update_available, th.update_version, th.version), active: th.active })),
    ],
  }
}

/** Koppelcode normaliseren: hoofdletters, zonder spaties/streepjes. */
export function normalizePairingCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '')
}
