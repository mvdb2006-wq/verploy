import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'
import type { Database } from '@/lib/database.types'
import { resilientFetch } from './fetch'

// Onderhoud (cron) roept soms zware RPC's aan: schrijven krijgt ruim de tijd, lezen blijft kort.
const adminFetch = resilientFetch({ writeTimeoutMs: 120_000 })

/**
 * Service-role-client: omzeilt RLS. Alleen gebruiken in route handlers die de
 * aanvrager zelf authenticeren (HMAC) of na een expliciete rechtencheck.
 */
export function createAdminClient() {
  const e = env()
  return createClient<Database>(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: adminFetch },
  })
}
