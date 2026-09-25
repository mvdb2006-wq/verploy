import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { safeNext } from '@/lib/safe-next'
import { mfaState } from '@/lib/mfa'
import { TwoFactorForm } from '../../forms'

export async function generateMetadata() {
  return { title: (await getT())('mfa.loginTitle') }
}

/** Tweede stap van het inloggen: de code uit de authenticator-app. */
export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const next = safeNext(sp.next, '/')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`)
  const mfa = await mfaState(supabase)
  if (!mfa.pending || !mfa.factorId) redirect(next)
  const t = await getT()
  return (
    <section>
      <h1 className="text-2xl font-extrabold tracking-tight">{t('mfa.loginTitle')}</h1>
      <p className="mt-1 mb-8 text-sm text-muted">{t('mfa.loginSubtitle')}</p>
      <TwoFactorForm next={next} factorId={mfa.factorId} />
    </section>
  )
}
