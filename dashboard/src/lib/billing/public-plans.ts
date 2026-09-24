import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'

export interface PublicPlan { id: string; name: string; price_cents: number; currency: string; sites_limit: number }

/**
 * De openbare plannen uit de database (bron van waarheid voor code, prijs en limiet). Ook voor bezoekers
 * die nog niet zijn ingelogd (registratie), daarom via de server en alleen deze vijf kolommen.
 */
export const publicPlans = cache(async (): Promise<PublicPlan[]> => {
  const { data, error } = await createAdminClient().from('plans')
    .select('id, name, price_cents, currency, sites_limit').eq('is_public', true).order('sort_order')
  if (error) throw error
  return data ?? []
})
