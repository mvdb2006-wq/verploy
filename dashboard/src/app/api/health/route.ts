import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/** Openbare healthcheck (voor uptime-monitoring): app draait en de database is bereikbaar. Geen gegevens. */
export async function GET() {
  const { error } = await createAdminClient().from('plans').select('id', { head: true, count: 'exact' })
  return NextResponse.json({ ok: !error }, { status: error ? 503 : 200, headers: { 'cache-control': 'no-store' } })
}
