import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/database.types'
import { feedSlug, matchComponents, normalizeFeedRecord, type FeedRecord, type SiteComponent, type VulnerabilityRecord } from './match'
import { streamObjectValues, textChunks } from './stream'

type Admin = SupabaseClient<Database>

export const WORDFENCE_FEED_URL = 'https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production'
const REFRESH_EVERY_MS = 4 * 3600_000
const RETRY_AFTER_ERROR_MS = 15 * 60_000
const RETRY_AFTER_RATE_LIMIT_MS = 2 * 3600_000
const BATCH = 500

export interface FeedResult { skipped: boolean; stored: number; seen: number; error?: string }

interface Attribution { notice: string; license: string; license_url: string }

function attributionOf(v: unknown): Attribution | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.notice !== 'string' || typeof o.license !== 'string') return null
  return { notice: o.notice.slice(0, 300), license: o.license.slice(0, 2000), license_url: typeof o.license_url === 'string' ? o.license_url.slice(0, 300) : '' }
}

/**
 * Haalt de Wordfence-feed op (hooguit elke 4 uur) en slaat nieuwe/gewijzigde records op.
 * Zonder API-sleutel doet hij niets: de functie staat dan uit.
 */
export async function refreshFeed(
  admin: Admin,
  opts: { apiKey?: string; url?: string; fetchImpl?: typeof fetch; force?: boolean; now?: number } = {},
): Promise<FeedResult> {
  if (!opts.apiKey) return { skipped: true, stored: 0, seen: 0 }
  const now = opts.now ?? Date.now()
  const { data: state, error: stateErr } = await admin.from('vulnerability_feed_state').select('*').eq('id', 1).single()
  if (stateErr) throw stateErr
  // Na een geslaagde ronde: elke 4 uur. Na een fout: na 15 minuten opnieuw proberen (bij 429: na 2 uur).
  const lastOk = state.fetched_at ? Date.parse(state.fetched_at) : 0
  const lastErr = state.last_error_at ? Date.parse(state.last_error_at) : 0
  // Bij een limiet van Wordfence (HTTP 429) langer wachten, anders blijft de limiet steeds verlengd.
  const retryAfter = state.last_error === 'feed_http_429' ? RETRY_AFTER_RATE_LIMIT_MS : RETRY_AFTER_ERROR_MS
  const due = lastErr > lastOk ? now - lastErr >= retryAfter : now - lastOk >= REFRESH_EVERY_MS
  if (!opts.force && !due) return { skipped: true, stored: 0, seen: 0 }

  const since = state.source_updated_max ? Date.parse(state.source_updated_max) : null
  let maxUpdated = since
  let stored = 0
  let seen = 0
  const attribution: Record<string, Attribution> = { ...((state.attribution ?? {}) as unknown as Record<string, Attribution>) }
  let batch: VulnerabilityRecord[] = []
  const flush = async () => {
    if (batch.length === 0) return
    // Eén rij per sleutel per upsert (Postgres weigert dezelfde rij twee keer in één opdracht).
    const unique = new Map(batch.map(r => [`${r.id}|${r.software_type}|${r.slug}`, r]))
    const rows = [...unique.values()].map(r => ({ ...r, affected: r.affected as unknown as Json, fetched_at: new Date(now).toISOString() }))
    batch = []
    const { error } = await admin.from('vulnerabilities').upsert(rows, { onConflict: 'id,software_type,slug' })
    if (error) throw error
    stored += rows.length
  }

  try {
    const res = await (opts.fetchImpl ?? fetch)(opts.url ?? WORDFENCE_FEED_URL, {
      headers: { authorization: `Bearer ${opts.apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10 * 60_000),
    })
    if (!res.ok || !res.body) throw new Error(`feed_http_${res.status}`)
    for await (const value of streamObjectValues(textChunks(res.body))) {
      seen++
      const rec = value as FeedRecord
      const cr = rec.copyrights as Record<string, unknown> | null | undefined
      if (cr) for (const party of ['defiant', 'mitre'] as const) {
        if (!attribution[party]) { const a = attributionOf(cr[party]); if (a) attribution[party] = a }
      }
      for (const row of normalizeFeedRecord(rec)) {
        const updated = row.source_updated_at ? Date.parse(row.source_updated_at) : null
        if (since !== null && updated !== null && updated <= since) continue
        if (updated !== null && (maxUpdated === null || updated > maxUpdated)) maxUpdated = updated
        batch.push(row)
        if (batch.length >= BATCH) await flush()
      }
    }
    await flush()
    if (seen === 0) throw new Error('feed_empty')
  } catch (e) {
    const message = (e as Error).message.slice(0, 300)
    await admin.from('vulnerability_feed_state').update({ last_error: message, last_error_at: new Date(now).toISOString() }).eq('id', 1)
    return { skipped: false, stored, seen, error: message }
  }

  const { count } = await admin.from('vulnerabilities').select('id', { count: 'exact', head: true })
  const { error: upErr } = await admin.from('vulnerability_feed_state').update({
    fetched_at: new Date(now).toISOString(),
    source_updated_max: maxUpdated === null ? null : new Date(maxUpdated).toISOString(),
    record_count: count ?? 0,
    last_error: null, last_error_at: null,
    attribution: attribution as unknown as Json,
  }).eq('id', 1)
  if (upErr) throw upErr
  return { skipped: false, stored, seen }
}

export interface EvaluateResult { evaluated: number; open: number; autofixStarted: number; stale: number }

/**
 * Beoordeelt sites waarvoor iets veranderd is (nieuwe heartbeat of nieuwe feed): bevindingen vastleggen,
 * melding bijwerken en — als het bureau dat wil — ernstige lekken direct veilig laten oplossen.
 */
export async function evaluateSites(admin: Admin, opts: { limit?: number; deadlineMs?: number } = {}): Promise<EvaluateResult> {
  const deadline = Date.now() + (opts.deadlineMs ?? 60_000)
  const { data: due, error } = await admin.rpc('sites_due_for_vulnerability_check', { p_limit: opts.limit ?? 50 })
  if (error) throw error
  let evaluated = 0
  let open = 0
  let autofixStarted = 0
  let stale = 0
  // Feed-stand vóór het lezen van de lekken: is de feed intussen vernieuwd, dan weigert de database de uitkomst.
  const { data: feed, error: fErr0 } = await admin.from('vulnerability_feed_state').select('fetched_at').eq('id', 1).single()
  if (fErr0) throw fErr0
  for (const { site_id } of due ?? []) {
    if (Date.now() > deadline) break
    // Eerst de heartbeat-teller, dan de onderdelen: de onderdelen zijn dus minstens zo nieuw als de teller.
    // Komt er daarna nog een heartbeat binnen, dan klopt de teller niet meer en weigert de database de uitkomst.
    const { data: site, error: hErr } = await admin.from('sites').select('heartbeat_seq').eq('id', site_id).single()
    if (hErr) throw hErr
    const { data: comps, error: cErr } = await admin
      .from('site_components')
      .select('type, slug, name, version, latest_version, update_available')
      .eq('site_id', site_id)
    if (cErr) throw cErr
    const components = (comps ?? []) as SiteComponent[]
    const slugs = [...new Set(components.map(c => feedSlug(c)))]
    const bySlug = new Map<string, VulnerabilityRecord[]>()
    if (slugs.length) {
      const { data: vulns, error: vErr } = await admin.from('vulnerabilities').select('*').in('slug', slugs)
      if (vErr) throw vErr
      for (const v of vulns ?? []) {
        const rec = v as unknown as VulnerabilityRecord
        const key = `${rec.software_type}:${rec.slug}`
        bySlug.set(key, [...(bySlug.get(key) ?? []), rec])
      }
    }
    const findings = matchComponents(components, bySlug)
    const { data: n, error: sErr } = await admin.rpc('sync_site_vulnerabilities', {
      p_site: site_id, p_findings: findings as unknown as Json, p_heartbeat_seq: site.heartbeat_seq, p_feed_at: feed.fetched_at ?? undefined,
    })
    if (sErr) throw sErr
    if (n === null) { stale++; continue }   // intussen nieuwe heartbeat of feed: volgende ronde opnieuw
    evaluated++
    open += n
  }

  // Automatisch oplossen (alleen bureaus die dat hebben aangezet; de database bepaalt wat er in aanmerking komt).
  const { data: pending, error: pErr } = await admin.rpc('pending_security_fixes', { p_limit: 20 })
  if (pErr) throw pErr
  for (const p of pending ?? []) {
    const { data: runId, error: fErr } = await admin.rpc('start_security_fix', { p_site: p.site_id, p_items: p.items })
    if (fErr) throw fErr
    if (runId) autofixStarted++
  }
  return { evaluated, open, autofixStarted, stale }
}
