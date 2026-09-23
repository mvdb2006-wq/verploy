import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'
import type { Database } from '@/lib/database.types'

/** Supabase-client namens de ingelogde gebruiker (RLS geldt). */
export async function createClient() {
  const cookieStore = await cookies()
  const e = env()
  return createServerClient<Database>(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: toSet => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options)
        } catch {
          // Vanuit een Server Component kunnen cookies niet gezet worden; proxy.ts ververst de sessie.
        }
      },
    },
  })
}
