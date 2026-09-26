import { requireAgency } from '@/lib/session'
import { getT } from '@/lib/i18n/server'
import { createClient } from '@/lib/supabase/server'
import { requestNow } from '@/lib/format'
import { loadOperations } from '@/lib/operations/load'
import { appVersion } from '@/lib/version'
import { isPlatformAdmin } from '@/lib/admin/load'
import { Sidebar } from './sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAgency()
  const t = await getT()
  const supabase = await createClient()
  const [ops, isAdmin] = await Promise.all([loadOperations(supabase, session.agency, requestNow()), isPlatformAdmin()])
  const { version, build } = appVersion()
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar
        agencyName={session.agency.name}
        email={session.user.email ?? ''}
        inboxCount={ops.inbox.length}
        version={build ? `${version} · ${build}` : version}
        isAdmin={isAdmin}
        labels={{
          overview: t('nav.overview'), inbox: t('nav.inbox'), sites: t('nav.sites'), updates: t('nav.updates'), security: t('nav.security'),
          reports: t('nav.reports'), settings: t('nav.settings'), signOut: t('nav.signOut'), agency: t('nav.agency'),
          mainNav: t('nav.mainNav'), version: t('nav.version'), customers: t('admin.nav'),
        }}
      />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">{children}</main>
    </div>
  )
}
