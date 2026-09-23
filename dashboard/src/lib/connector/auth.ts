import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { decryptSecret } from '@/lib/security/secretbox'
import { keyMaterial } from '@/lib/security/keys'
import { readSignedHeaders, verify } from '@/lib/security/signing'

export type AuthFailure = 'missing_signature' | 'unknown_site' | 'stale' | 'bad_signature' | 'replay'

export type SignedAuth =
  | { ok: true; siteId: string }
  | { ok: false; reason: AuthFailure }

/**
 * Authenticeert een HMAC-gesigneerd plugin-request (PLAN.md §4):
 * handtekening (huidig of nog-geldig vorig secret), tijdvenster ±300 s en eenmalige nonce.
 */
export async function authenticateSigned(
  admin: SupabaseClient<Database>,
  req: Request,
  rawBody: string,
): Promise<SignedAuth> {
  const h = readSignedHeaders(name => req.headers.get(name))
  if (!h) return { ok: false, reason: 'missing_signature' }

  const { data: cred } = await admin
    .from('site_credentials')
    .select('secret_ciphertext, previous_secret_ciphertext, previous_valid_until')
    .eq('site_id', h.siteId)
    .maybeSingle()
  if (!cred?.secret_ciphertext) return { ok: false, reason: 'unknown_site' }

  const km = keyMaterial()
  const secrets = [decryptSecret(cred.secret_ciphertext, km)]
  if (cred.previous_secret_ciphertext && cred.previous_valid_until && new Date(cred.previous_valid_until) > new Date()) {
    secrets.push(decryptSecret(cred.previous_secret_ciphertext, km))
  }

  const path = new URL(req.url).pathname
  const result = verify(secrets, h, req.method, path, rawBody)
  if (!result.ok) return { ok: false, reason: result.reason }

  const { error } = await admin.from('signed_request_nonces').insert({ site_id: h.siteId, nonce: h.nonce })
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'replay' }
    throw error
  }
  return { ok: true, siteId: h.siteId }
}
