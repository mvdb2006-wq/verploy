import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/dashboard/Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch agency membership for this user
  let { data: membership } = await supabase
    .from('agency_members')
    .select('agency_id, role, agencies(id, name, slug)')
    .eq('user_id', user.id)
    .single()

  // Auto-provision agency for existing accounts that pre-date the auth callback fix
  if (!membership) {
    const service = createServiceClient()
    const emailPrefix = (user.email?.split('@')[0] ?? 'user')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 20)
    const slug = `${emailPrefix}-${Math.random().toString(36).slice(2, 6)}`

    const { error: agencyError } = await service
      .from('agencies')
      .insert({ owner_id: user.id, name: emailPrefix, slug })

    if (!agencyError) {
      // Re-fetch now that the trigger has created the agency_members row
      const { data: m } = await supabase
        .from('agency_members')
        .select('agency_id, role, agencies(id, name, slug)')
        .eq('user_id', user.id)
        .single()
      membership = m
    } else {
      console.error('[verploy] auto-provision agency failed:', agencyError)
    }
  }

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
