import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getT } from '@/lib/i18n/server'
import { canManage, requireAgency } from '@/lib/session'
import { NewSiteForm } from './form'

export async function generateMetadata() {
  return { title: (await getT())('sitesNew.title') }
}

export default async function NewSitePage() {
  const session = await requireAgency()
  if (!canManage(session.role)) redirect('/')
  const t = await getT()
  return (
    <div className="mx-auto max-w-xl">
      <Link href="/" className="text-sm text-muted hover:text-text">← {t('siteDetail.back')}</Link>
      <h1 className="mt-3 mb-8 text-2xl font-extrabold tracking-tight">{t('sitesNew.title')}</h1>
      <NewSiteForm defaultLocale={session.agency.dashboard_locale} />
    </div>
  )
}
