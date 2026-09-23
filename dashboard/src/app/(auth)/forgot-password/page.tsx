import Link from 'next/link'
import { getT } from '@/lib/i18n/server'
import { ForgotForm } from '../forms'

export async function generateMetadata() {
  return { title: (await getT())('auth.forgot.title') }
}

export default async function ForgotPasswordPage() {
  const t = await getT()
  return (
    <section>
      <h1 className="text-2xl font-extrabold tracking-tight">{t('auth.forgot.title')}</h1>
      <p className="mt-1 mb-8 text-sm text-muted">{t('auth.forgot.body')}</p>
      <ForgotForm />
      <Link href="/login" className="mt-8 inline-block text-sm text-muted hover:text-text">← {t('auth.forgot.back')}</Link>
    </section>
  )
}
