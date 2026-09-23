import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateSigned } from '@/lib/connector/auth'
import { heartbeatSchema, toRows } from '@/lib/connector/payload'
import { json, readBody } from '@/lib/connector/http'
import { HEARTBEAT_INTERVAL_SECONDS } from '@/lib/connector/release'
import { sameSite } from '@/lib/url'

export const dynamic = 'force-dynamic'

/** POST /api/v2/heartbeat — HMAC-gesigneerde health-data van Verploy Connector ≥ 2.0. */
export async function POST(req: Request) {
  const raw = await readBody(req)
  if (raw === null) return json({ error: 'payload_too_large' }, 413)

  const admin = createAdminClient()
  const auth = await authenticateSigned(admin, req, raw)
  if (!auth.ok) return json({ error: 'unauthorized', reason: auth.reason }, 401)

  let body: unknown
  try { body = JSON.parse(raw) } catch { return json({ error: 'invalid_json' }, 400) }
  const parsed = heartbeatSchema.safeParse(body)
  if (!parsed.success) {
    return json({ error: 'invalid_payload', issues: parsed.error.issues.slice(0, 10).map(i => i.path.join('.')) }, 422)
  }

  const { data: site } = await admin.from('sites').select('url').eq('id', auth.siteId).single()
  // Een gekloonde site (bijv. staging) met hetzelfde secret mag de echte site niet overschrijven.
  if (!site || !sameSite(parsed.data.site.url, site.url)) {
    return json({ error: 'site_url_mismatch', expected_url: site?.url ?? null }, 409)
  }

  const rows = toRows(parsed.data)
  const { error } = await admin.rpc('ingest_heartbeat', {
    p_site: auth.siteId,
    p_snapshot: rows.snapshot as never,
    p_components: rows.components as never,
  })
  if (error) {
    if (error.message.includes('site_not_connected')) return json({ error: 'site_not_connected' }, 409)
    throw error
  }
  return json({ ok: true, next_heartbeat_in: HEARTBEAT_INTERVAL_SECONDS })
}
