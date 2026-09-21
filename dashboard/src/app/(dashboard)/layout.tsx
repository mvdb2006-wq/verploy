import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/dashboard/Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch agency for this user
  const { data: membership } = await supabase
    .from('agency_members')
    .select('agency_id, role, agencies(id, name, slug)')
    .eq('user_id', user.id)
    .single()

  const agenciesRaw = membership?.agencies
  const agency = (Array.isArray(agenciesRaw) ? agenciesRaw[0] : agenciesRaw) as { id: string; name: string; slug: string } | null ?? null

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar user={user} agency={agency} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
