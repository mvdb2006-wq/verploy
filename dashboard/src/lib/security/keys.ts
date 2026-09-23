import 'server-only'
import { env } from '@/lib/env'
import type { KeyMaterial } from './secretbox'

export function keyMaterial(): KeyMaterial {
  const e = env()
  return { primary: e.VERPLOY_ENCRYPTION_KEY || undefined, serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY }
}
