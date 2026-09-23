import { requireAgency } from '@/lib/session'
import { getT } from '@/lib/i18n/server'
import { Sidebar } from './sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAgency()
  const t = await getT()
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar
        agencyName={session.agency.name}
        email={session.user.email ?? ''}
        labels={{ sites: t('nav.sites'), settings: t('nav.settings'), team: t('nav.team'), signOut: t('nav.signOut'), agency: t('nav.agency'), mainNav: t('nav.mainNav') }}
      />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">{children}</main>
    </div>
  )
}
