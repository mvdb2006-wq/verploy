import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Vercel roept deze route elk uur aan via vercel.json crons.
// Sites die langer dan 2 uur niet gepingd hebben worden op 'offline' gezet.

export async function GET(req: NextRequest) {
  // Vercel stuurt de CRON_SECRET als Authorization header
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient()

  // Sites die ooit gepingd hebben maar nu te lang stil zijn
  const { data: staleSites, error } = await supabase
    .from('sites')
    .select('id, name')
    .eq('status', 'online')
    .lt('last_ping_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())

  if (error) {
    console.error('[verploy cron] query error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }

  if (!staleSites || staleSites.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 })
  }

  const staleIds = staleSites.map(s => s.id)

  const { error: updateError } = await supabase
    .from('sites')
    .update({ status: 'offline' })
    .in('id', staleIds)

  if (updateError) {
    console.error('[verploy cron] update error:', updateError)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }

  console.log(`[verploy cron] ${staleSites.length} site(s) offline gezet:`, staleSites.map(s => s.name))

  return NextResponse.json({ ok: true, updated: staleSites.length })
}
