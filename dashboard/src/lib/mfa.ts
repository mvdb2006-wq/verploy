import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Tweestapsverificatie (Supabase MFA, TOTP-app zoals Google Authenticator of 1Password).
 *  - enabled: de gebruiker heeft een bevestigde authenticator;
 *  - verified: deze sessie is met de code bevestigd (aal2);
 *  - pending: 2FA staat aan maar de code is in deze sessie nog niet ingevoerd.
 */
export interface MfaState { enabled: boolean; verified: boolean; pending: boolean; factorId: string | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function mfaState(supabase: SupabaseClient<any>): Promise<MfaState> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const totp = (factors?.totp ?? []).find(f => f.status === 'verified') ?? null
  const verified = data?.currentLevel === 'aal2'
  const enabled = Boolean(totp) || data?.nextLevel === 'aal2'
  return { enabled, verified, pending: enabled && !verified, factorId: totp?.id ?? null }
}
