import type { MessageKey } from '@/lib/i18n/core'

interface PgLikeError { code?: string; message?: string; details?: string | null }

/** Vertaalt bekende databasefouten (raise exception in RPC's/triggers) naar i18n-sleutels. */
export function dbErrorKey(err: PgLikeError | null | undefined, fallback: MessageKey = 'common.errorGeneric'): MessageKey {
  if (!err) return fallback
  const m = err.message ?? ''
  if (m.includes('site_limit_reached')) return 'sitesNew.errorLimit'
  if (m.includes('subscription_inactive')) return 'sitesNew.errorInactive'
  if (m.includes('last_owner')) return 'team.errorLastOwner'
  if (m.includes('already_member')) return 'team.errorAlreadyMember'
  if (m.includes('invitation_email_mismatch')) return 'invite.errorMismatch'
  if (m.includes('invalid_invitation')) return 'invite.errorInvalid'
  if (err.code === '23505' && m.includes('sites_agency_id_url_key')) return 'sitesNew.errorDuplicate'
  if (m.includes('run_active')) return 'runs.errorActive'
  if (m.includes('no_update_available')) return 'runs.errorNoUpdate'
  if (m.includes('connector_outdated')) return 'runs.errorConnector'
  if (m.includes('not_connected')) return 'runs.errorNotConnected'
  if (m.includes('read_only')) return 'runs.errorReadOnly'
  if (m.includes('not_cancellable')) return 'runs.errorNotCancellable'
  if (m.includes('no_items') || m.includes('too_many_items')) return 'runs.errorNoItems'
  if (err.code === '42501' || m.includes('forbidden') || m.includes('row-level security')) return 'common.errorForbidden'
  return fallback
}

/** Haalt `limit=15` uit het detail van site_limit_reached. */
export function limitFromError(err: PgLikeError | null | undefined): number | null {
  const match = /limit=(\d+)/.exec(err?.details ?? '')
  return match ? Number(match[1]) : null
}
