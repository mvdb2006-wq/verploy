import { redirect } from 'next/navigation'
import { Logo } from '@/components/Logo'
import { getT } from '@/lib/i18n/server'
import { getSession } from '@/lib/session'
import { UpdatePasswordForm } from '../../(auth)/forms'

export default async function UpdatePasswordPage() {
  if (!(await getSession())) redirect('/login?error=link')
  const t = await getT()
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px]">
        <Logo className="mb-10" size={30} />
        <h1 className="mb-8 text-2xl font-extrabold tracking-tight">{t('auth.reset.title')}</h1>
        <UpdatePasswordForm />
      </div>
    </main>
  )
}
