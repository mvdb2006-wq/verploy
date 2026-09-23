import Link from 'next/link'
import { Alert } from '@/components/Alert'
import { Logo } from '@/components/Logo'
import { SubmitButton } from '@/components/SubmitButton'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { getSession } from '@/lib/session'
import type { MessageKey } from '@/lib/i18n/core'
import { acceptInvitation } from './actions'

const INVITE_ERRORS: MessageKey[] = ['invite.errorInvalid', 'invite.errorMismatch', 'invite.errorAlready', 'common.errorGeneric', 'common.errorForbidden']

export default async function InvitePage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { token } = await params
  const { error } = await searchParams
  const t = await getT()
  const supabase = await createClient()
  const { data } = await supabase.rpc('peek_invitation', { p_token: token })
  const invite = data?.[0]
  const session = await getSession()
  const self = `/invite/${token}`

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-[440px]">
        <Logo className="mb-10" size={30} />
        <h1 className="mb-4 text-2xl font-extrabold tracking-tight">{t('invite.title')}</h1>
        {!invite || !invite.valid ? (
          <Alert>{t('invite.errorInvalid')}</Alert>
        ) : (
          <div className="space-y-5">
            <p className="text-muted">
              {t('invite.body', { agency: invite.agency_name, role: t(`team.role.${invite.role}` as MessageKey).toLowerCase() })}
            </p>
            {error && INVITE_ERRORS.includes(error as MessageKey) && <Alert>{t(error as MessageKey)}</Alert>}
            {session ? (
              <form action={acceptInvitation} className="space-y-4">
                <input type="hidden" name="token" value={token} />
                <p className="text-sm text-subtle">{t('invite.signedInAs', { email: session.user.email ?? '' })}</p>
                <SubmitButton className="w-full">{t('invite.accept')}</SubmitButton>
              </form>
            ) : (
              <>
                <p className="text-sm text-subtle">{t('invite.loginFirst', { email: invite.email })}</p>
                <div className="flex gap-3">
                  <Link className="btn btn-primary flex-1" href={`/signup?next=${encodeURIComponent(self)}&email=${encodeURIComponent(invite.email)}`}>
                    {t('auth.signup.submit')}
                  </Link>
                  <Link className="btn btn-ghost flex-1" href={`/login?next=${encodeURIComponent(self)}&email=${encodeURIComponent(invite.email)}`}>
                    {t('auth.login.submit')}
                  </Link>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
