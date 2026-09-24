import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { getT } from '@/lib/i18n/server'

export default async function NotFound() {
  const t = await getT()
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <div>
        <p className="font-mono text-sm text-subtle">404</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{t('errors.notFoundTitle')}</h1>
        <p className="mt-2 max-w-sm text-sm text-muted">{t('errors.notFoundBody')}</p>
      </div>
      <Link href="/" className="btn btn-primary">{t('errors.back')}</Link>
    </main>
  )
}
