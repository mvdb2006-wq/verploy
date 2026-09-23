import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { checkSsl } from './ssl'
import { lookupDomainExpiry } from './rdap'
import { dispatchNotifications, type DispatchResult } from './notify'

const SSL_EVERY_MS = 12 * 3600_000
const DOMAIN_EVERY_MS = 24 * 3600_000

export interface MaintenanceResult { evaluated: number; checked: number; notifications: DispatchResult }

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x)
  }))
}

/**
 * Periodiek onderhoud (idempotent, veilig om vaak te draaien):
 *  1. alle drempelregels opnieuw evalueren (o.a. offline-detectie)
 *  2. SSL (elke 12 u) en domein (elke 24 u) controleren voor gekoppelde sites
 *  3. openstaande e-mailmeldingen versturen
 */
export async function runMaintenance(
  admin: SupabaseClient<Database>,
  opts: { batch?: number; deadlineMs?: number; ssl?: typeof checkSsl; domain?: typeof lookupDomainExpiry } = {},
): Promise<MaintenanceResult> {
  const deadline = Date.now() + (opts.deadlineMs ?? 40_000)
  const { data: evaluated, error } = await admin.rpc('sweep_alerts')
  if (error) throw error

  const now = Date.now()
  const { data: sites } = await admin
    .from('sites')
    .select('id, url, ssl_checked_at, domain_checked_at')
    .eq('connection_status', 'connected')
    .or(`ssl_checked_at.is.null,ssl_checked_at.lt.${new Date(now - SSL_EVERY_MS).toISOString()},domain_checked_at.is.null,domain_checked_at.lt.${new Date(now - DOMAIN_EVERY_MS).toISOString()}`)
    .order('ssl_checked_at', { ascending: true, nullsFirst: true })
    .limit(opts.batch ?? 40)

  let checked = 0
  const ssl = opts.ssl ?? checkSsl
  const domain = opts.domain ?? lookupDomainExpiry
  await pool(sites ?? [], 5, async site => {
    if (Date.now() > deadline) return
    const isHttps = site.url.startsWith('https://')
    const sslResult = isHttps ? await ssl(site.url) : { valid: null, expiresAt: null, issuer: null, error: null }
    const domainDue = !site.domain_checked_at || Date.parse(site.domain_checked_at) < now - DOMAIN_EVERY_MS
    const domainResult = domainDue ? await domain(site.url) : null
    const { error: recErr } = await admin.rpc('record_site_checks', {
      p_site: site.id,
      p_ssl_valid: sslResult.valid,
      p_ssl_expires_at: sslResult.expiresAt,
      p_ssl_issuer: sslResult.issuer,
      p_ssl_error: sslResult.error,
      p_domain_expires_at: domainResult?.expiresAt ?? null,
      p_domain_error: domainResult?.error ?? null,
      p_domain_checked: domainResult !== null,
    })
    if (recErr) throw recErr
    checked++
  })

  const notifications = await dispatchNotifications(admin, { limit: 50 })
  return { evaluated: evaluated ?? 0, checked, notifications }
}
