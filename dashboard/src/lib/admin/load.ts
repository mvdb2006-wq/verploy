import 'server-only'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/billing/stripe'
import { toCustomer, type Customer, type CustomerRow, type StripeFacts } from './customers'
import { loadStripeFacts } from './stripe-facts'

/** Alleen voor de beheerder van Verploy; anderen krijgen een 404 (het scherm "bestaat" voor hen niet). */
export async function requirePlatformAdmin() {
  const supabase = await createClient()
  const { data } = await supabase.rpc('is_platform_admin')
  if (!data) notFound()
  return supabase
}

export async function isPlatformAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('is_platform_admin')
  return Boolean(data)
}

export interface CustomersData { customers: Customer[]; stripeOk: boolean; fetchedAt: string }

export async function loadCustomers(): Promise<CustomersData> {
  const supabase = await requirePlatformAdmin()
  const { data, error } = await supabase.rpc('admin_customers')
  if (error) throw error
  const s = stripe()
  let facts: Map<string, StripeFacts> | null = null
  if (s) {
    try { facts = await loadStripeFacts(s) } catch (err) { console.error('[admin] Stripe niet bereikbaar', (err as Error).message) }
  }
  const customers = ((data ?? []) as CustomerRow[]).map(r => toCustomer(r, r.stripe_customer_id && facts ? facts.get(r.stripe_customer_id) ?? {} : null))
  return { customers, stripeOk: Boolean(facts), fetchedAt: new Date().toISOString() }
}
