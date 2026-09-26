import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { requireAgency } from '@/lib/session'
import { mfaState } from '@/lib/mfa'
import type { MessageKey } from '@/lib/i18n/core'
import { TwoFactor } from './two-factor'
import { DeleteAgency } from './delete-agency'

export async function generateMetadata() {
  return { title: (await getT())('mfa.pageTitle') }
}

/** Je eigen account: e-mailadres en tweestapsverificatie. */
export default async function AccountPage() {
  const session = await requireAgency()
  const [t, supabase] = await Promise.all([getT(), createClient()])
  const owner = session.role === 'owner'
  const [mfa, members] = await Promise.all([
    mfaState(supabase),
    owner ? supabase.from('agency_members').select('user_id', { count: 'exact', head: true }).then(r => r.count ?? 1) : Promise.resolve(1),
  ])
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('mfa.pageTitle')}</h1>
      <section className="card space-y-2" aria-labelledby="account-email">
        <h2 id="account-email" className="font-bold">{t('mfa.emailTitle')}</h2>
        <p className="font-mono text-sm">{session.user.email}</p>
      </section>
      <section className="card space-y-1" aria-labelledby="account-role">
        <h2 id="account-role" className="font-bold">{t('team.yourRole')}</h2>
        <p className="text-sm" data-testid="account-role"><strong>{t(`team.role.${session.role}` as MessageKey)}</strong> <span className="text-muted">· {session.agency.name}</span></p>
        <p className="text-sm text-muted">{t(`team.roleExplain.${session.role}` as MessageKey)}</p>
      </section>
      <section className="card space-y-4" id="two-factor" aria-labelledby="two-factor-title">
        <div>
          <h2 id="two-factor-title" className="font-bold">{t('mfa.title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('mfa.intro')}</p>
        </div>
        <TwoFactor enabled={mfa.enabled} factorId={mfa.factorId} />
      </section>
      {owner
        ? <DeleteAgency name={session.agency.name} members={members} subscribed={Boolean(session.agency.stripe_subscription_id)} />
        : <p className="text-sm text-muted">{t('accountDelete.memberNote')}</p>}
    </div>
  )
}
