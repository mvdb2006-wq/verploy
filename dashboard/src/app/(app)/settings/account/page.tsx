import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { requireAgency } from '@/lib/session'
import { mfaState } from '@/lib/mfa'
import { TwoFactor } from './two-factor'

export async function generateMetadata() {
  return { title: (await getT())('mfa.pageTitle') }
}

/** Je eigen account: e-mailadres en tweestapsverificatie. */
export default async function AccountPage() {
  const session = await requireAgency()
  const [t, supabase] = await Promise.all([getT(), createClient()])
  const mfa = await mfaState(supabase)
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('mfa.pageTitle')}</h1>
      <section className="card space-y-2" aria-labelledby="account-email">
        <h2 id="account-email" className="font-bold">{t('mfa.emailTitle')}</h2>
        <p className="font-mono text-sm">{session.user.email}</p>
      </section>
      <section className="card space-y-4" id="two-factor" aria-labelledby="two-factor-title">
        <div>
          <h2 id="two-factor-title" className="font-bold">{t('mfa.title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('mfa.intro')}</p>
        </div>
        <TwoFactor enabled={mfa.enabled} factorId={mfa.factorId} />
      </section>
    </div>
  )
}
