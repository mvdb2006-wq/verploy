import { redirect } from 'next/navigation'
import { Logo } from '@/components/Logo'
import { getT } from '@/lib/i18n/server'
import { getSession } from '@/lib/session'
import { OnboardingForm } from './form'

export default async function OnboardingPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.agency) redirect('/')
  const t = await getT()
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-[440px]">
        <Logo className="mb-10" size={30} />
        <h1 className="text-2xl font-extrabold tracking-tight">{t('onboarding.title')}</h1>
        <p className="mt-1 mb-8 text-sm text-muted">{t('onboarding.body')}</p>
        <OnboardingForm />
      </div>
    </main>
  )
}
