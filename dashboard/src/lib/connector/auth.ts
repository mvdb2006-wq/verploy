import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { decryptSecret, type KeyMaterial } from '@/lib/security/secretbox'
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

  const secrets = usableSecrets({ ...cred, secret_ciphertext: cred.secret_ciphertext }, keyMaterial())
  // Geen enkel secret te ontsleutelen (bijv. versleuteld met een vervangen sleutel): opnieuw koppelen nodig.
  if (secrets.length === 0) return { ok: false, reason: 'unknown_site' }

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

/**
 * De secrets waarmee een handtekening geldig kan zijn: het huidige en, tijdens de overgangsperiode na
 * opnieuw koppelen, het vorige. Een secret dat niet te ontsleutelen is (versleuteld met een sleutel
 * die inmiddels is vervangen) telt niet mee; dat mag een geldig nieuw secret niet blokkeren.
 */
export function usableSecrets(
  cred: { secret_ciphertext: string; previous_secret_ciphertext: string | null; previous_valid_until: string | null },
  km: KeyMaterial,
  now = Date.now(),
): string[] {
  const tryOpen = (box: string) => { try { return decryptSecret(box, km) } catch { return null } }
  const out: string[] = []
  const current = tryOpen(cred.secret_ciphertext)
  if (current !== null) out.push(current)
  if (cred.previous_secret_ciphertext && cred.previous_valid_until && Date.parse(cred.previous_valid_until) > now) {
    const previous = tryOpen(cred.previous_secret_ciphertext)
    if (previous !== null) out.push(previous)
  }
  return out
}
