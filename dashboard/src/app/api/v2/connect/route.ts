import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { connectSchema, normalizePairingCode } from '@/lib/connector/payload'
import { json, readBody } from '@/lib/connector/http'
import { HEARTBEAT_INTERVAL_SECONDS } from '@/lib/connector/release'
import { encryptSecret } from '@/lib/security/secretbox'
import { keyMaterial } from '@/lib/security/keys'
import { sha256Hex } from '@/lib/security/signing'
import { sameSite } from '@/lib/url'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v2/connect — de plugin wisselt een eenmalige koppelcode in voor een site-secret.
 * Niet gesigneerd (er is nog geen secret); beveiligd door 40-bit code, 30 min geldigheid,
 * eenmalig gebruik en controle dat het site-adres overeenkomt.
 */
export async function POST(req: Request) {
  const raw = await readBody(req)
  if (raw === null) return json({ error: 'payload_too_large' }, 413)
  let body: unknown
  try { body = JSON.parse(raw) } catch { return json({ error: 'invalid_json' }, 400) }
  const parsed = connectSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'invalid_request' }, 400)

  const codeHash = sha256Hex(normalizePairingCode(parsed.data.code))
  const admin = createAdminClient()

  const { data: cred } = await admin
    .from('site_credentials')
    .select('site_id, pairing_expires_at')
    .eq('pairing_code_hash', codeHash)
    .maybeSingle()
  if (!cred?.pairing_expires_at || new Date(cred.pairing_expires_at) <= new Date()) {
    return json({ error: 'invalid_code' }, 404)
  }

  const { data: site } = await admin.from('sites').select('url').eq('id', cred.site_id).single()
  if (!site || !sameSite(parsed.data.site_url, site.url)) {
    return json({ error: 'site_url_mismatch', expected_url: site?.url ?? null }, 409)
  }

  const secret = randomBytes(32).toString('hex')
  const { data: rows, error } = await admin.rpc('consume_pairing_code', {
    p_code_hash: codeHash,
    p_secret_box: encryptSecret(secret, keyMaterial()),
    p_connector_version: parsed.data.connector_version,
  })
  if (error) throw error
  const row = rows?.[0]
  if (!row) return json({ error: 'invalid_code' }, 404)

  return json({ site_id: row.site_id, secret, heartbeat_interval: HEARTBEAT_INTERVAL_SECONDS })
}
