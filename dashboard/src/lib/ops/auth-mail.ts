import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Supabase kon een auth-mail (bevestigen, wachtwoord resetten) niet versturen. De gebruiker ziet bewust
 * altijd "mail verstuurd" (verraadt niet of een adres bestaat), dus meldt Verploy het aan de beheerder via
 * het alarm (ops_events → /api/cron/ops). Zonder e-mailadres in de melding.
 */
export function authMailFailure(err: { status?: number; code?: string; message?: string } | null | undefined): 'auth_mail_failed' | 'auth_mail_rate_limited' | null {
  if (!err) return null
  if (err.code === 'over_email_send_rate_limit') return 'auth_mail_rate_limited'
  if ((err.status ?? 0) >= 500 || err.code === 'unexpected_failure' || /smtp|sending (confirmation|recovery)|error sending/i.test(err.message ?? '')) return 'auth_mail_failed'
  return null
}

export async function reportAuthMailFailure(action: 'signup' | 'password_reset', err: { status?: number; code?: string; message?: string } | null | undefined): Promise<void> {
  const kind = authMailFailure(err)
  if (!kind) return
  await createAdminClient().from('ops_events')
    .insert({ source: 'app', kind, detail: `${action}: ${err?.code ?? '-'} ${err?.status ?? ''} ${err?.message ?? ''}`.trim().slice(0, 500) })
    .then(() => undefined, () => undefined)
}
