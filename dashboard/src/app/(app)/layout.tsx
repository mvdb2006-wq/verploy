import { requireAgency } from '@/lib/session'
import { getT } from '@/lib/i18n/server'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from './sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAgency()
  const t = await getT()
  const supabase = await createClient()
  const { count } = await supabase.from('alerts').select('id', { count: 'exact', head: true })
    .eq('status', 'open').in('severity', ['warning', 'critical']).is('acknowledged_at', null)
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar
        agencyName={session.agency.name}
        email={session.user.email ?? ''}
        alertCount={count ?? 0}
        labels={{ sites: t('nav.sites'), alerts: t('nav.alerts'), settings: t('nav.settings'), team: t('nav.team'), signOut: t('nav.signOut'), agency: t('nav.agency'), mainNav: t('nav.mainNav') }}
      />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">{children}</main>
    </div>
  )
}
