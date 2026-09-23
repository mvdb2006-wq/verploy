import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type Role = 'owner' | 'admin' | 'member'

export interface Session {
  user: User
  role: Role | null
  agency: Tables<'agencies'> | null
}

/** De ingelogde gebruiker + zijn bureau (één keer per request opgehaald). */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: membership } = await supabase
    .from('agency_members')
    .select('role, agency_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { user, role: null, agency: null }
  const { data: agency } = await supabase.from('agencies').select('*').eq('id', membership.agency_id).single()
  return { user, role: membership.role as Role, agency: agency ?? null }
})

export interface AgencySession extends Session {
  role: Role
  agency: Tables<'agencies'>
}

/** Voor pagina's binnen de app: ingelogd én lid van een bureau, anders doorsturen. */
export async function requireAgency(): Promise<AgencySession> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.agency || !session.role) redirect('/onboarding')
  return session as AgencySession
}

export function canManage(role: Role): boolean {
  return role === 'owner' || role === 'admin'
}

/** Mag het bureau nieuwe dingen doen (zelfde regel als app.agency_is_writable in de database)? */
export function agencyIsWritable(agency: Tables<'agencies'>, now = new Date()): boolean {
  if (agency.plan_status === 'active' || agency.plan_status === 'comped') return true
  return agency.plan_status === 'trialing' && agency.trial_ends_at !== null && new Date(agency.trial_ends_at) > now
}

/** Resterende proefdagen (afgerond naar boven), of null als het bureau niet in proef is. */
export function trialDaysLeft(agency: Tables<'agencies'>, now = new Date()): number | null {
  if (agency.plan_status !== 'trialing' || !agency.trial_ends_at) return null
  return Math.max(0, Math.ceil((new Date(agency.trial_ends_at).getTime() - now.getTime()) / 86_400_000))
}
