import Link from 'next/link'
import { Alert } from '@/components/Alert'
import { getT } from '@/lib/i18n/server'
import { safeNext } from '@/lib/safe-next'
import { LoginForm } from '../forms'

export async function generateMetadata() {
  return { title: (await getT())('auth.login.title') }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const t = await getT()
  const next = safeNext(sp.next, '/')
  return (
    <section>
      <h1 className="text-2xl font-extrabold tracking-tight">{t('auth.login.title')}</h1>
      <p className="mt-1 mb-8 text-sm text-muted">{t('auth.login.subtitle')}</p>
      {sp.error === 'link' && <Alert className="mb-4">{t('auth.linkInvalid')}</Alert>}
      {sp.deleted === '1' && <Alert tone="ok" className="mb-4">{t('accountDelete.done')}</Alert>}
      <LoginForm next={next} defaultEmail={sp.email} />
      <p className="mt-8 text-sm text-muted">
        {t('auth.login.noAccount')}{' '}
        <Link href={`/signup${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-accent hover:underline">
          {t('auth.login.signupLink')}
        </Link>
      </p>
    </section>
  )
}
