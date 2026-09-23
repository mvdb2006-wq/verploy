import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'
import type { Database } from '@/lib/database.types'

/**
 * Service-role-client: omzeilt RLS. Alleen gebruiken in route handlers die de
 * aanvrager zelf authenticeren (HMAC) of na een expliciete rechtencheck.
 */
export function createAdminClient() {
  const e = env()
  return createClient<Database>(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}
