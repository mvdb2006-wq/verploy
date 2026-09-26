import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
const { authMailFailure } = await import('./auth-mail')

describe('authMailFailure', () => {
  it('SMTP-fout of serverfout → alarm; limiet → eigen soort; gebruikersfouten niet', () => {
    expect(authMailFailure({ status: 500, code: 'unexpected_failure', message: 'dial tcp: lookup mail.resend.com: no such host' })).toBe('auth_mail_failed')
    expect(authMailFailure({ status: 500, message: 'Error sending recovery email' })).toBe('auth_mail_failed')
    expect(authMailFailure({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' })).toBe('auth_mail_rate_limited')
    expect(authMailFailure({ status: 422, code: 'user_already_exists' })).toBeNull()
    expect(authMailFailure({ status: 422, code: 'weak_password' })).toBeNull()
    expect(authMailFailure(null)).toBeNull()
  })
})
