import Link from 'next/link'
import { getT } from '@/lib/i18n/server'
import { safeNext } from '@/lib/safe-next'
import { SignupForm } from '../forms'

export async function generateMetadata() {
  return { title: (await getT())('auth.signup.title') }
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const t = await getT()
  const next = safeNext(sp.next, '/onboarding')
  return (
    <section>
      <h1 className="text-2xl font-extrabold tracking-tight">{t('auth.signup.title')}</h1>
      <p className="mt-1 mb-8 text-sm text-muted">{t('auth.signup.subtitle')}</p>
      <SignupForm next={next} defaultEmail={sp.email} />
      <p className="mt-8 text-sm text-muted">
        {t('auth.signup.haveAccount')}{' '}
        <Link href={`/login${next !== '/onboarding' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-accent hover:underline">
          {t('auth.signup.loginLink')}
        </Link>
      </p>
    </section>
  )
}
