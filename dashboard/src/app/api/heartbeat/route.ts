import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import type { HeartbeatPayload } from '@/types'

export async function POST(req: NextRequest) {
  // Extract API key from Authorization header
  const auth = req.headers.get('Authorization') ?? ''
  const apiKey = auth.replace('Bearer ', '').trim()

  if (!apiKey || !apiKey.startsWith('vp_live_')) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid API key' }, { status: 401 })
  }

  let payload: HeartbeatPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Delegate to the process_heartbeat DB function which handles everything
  const { data, error } = await supabase
    .rpc('process_heartbeat', {
      p_api_key: apiKey,
      p_payload: payload as unknown as Record<string, unknown>,
    })

  if (error) {
    console.error('[heartbeat] DB error:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  if (!data?.ok) {
    return NextResponse.json({ ok: false, error: data?.error ?? 'Unknown error' }, { status: 404 })
  }

  // Queue plugin update checks asynchronously (fire-and-forget)
  void checkForPendingUpdates(apiKey, payload, supabase)

  return NextResponse.json({ ok: true, snapshot_id: data.snapshot_id })
}

async function checkForPendingUpdates(
  apiKey: string,
  payload: HeartbeatPayload,
  supabase: ReturnType<typeof createServiceClient>
) {
  try {
    const pendingUpdates = payload.plugins.filter(p => p.active && p.update_available)
    if (pendingUpdates.length === 0) return

    // Look up site
    const { data: site } = await supabase
      .from('sites')
      .select('id, agency_id')
      .eq('api_key', apiKey)
      .single()

    if (!site) return

    // Create update_run rows for new pending updates (avoid duplicates)
    for (const plugin of pendingUpdates) {
      const { data: existing } = await supabase
        .from('update_runs')
        .select('id')
        .eq('site_id', site.id)
        .eq('slug', plugin.plugin_file)
        .eq('to_version', plugin.update_version)
        .in('status', ['queued', 'staging', 'testing'])
        .maybeSingle()

      if (!existing) {
        await supabase.from('update_runs').insert({
          site_id:      site.id,
          update_type:  'plugin',
          slug:         plugin.plugin_file,
          from_version: plugin.version,
          to_version:   plugin.update_version,
          status:       'queued',
          triggered_by: 'auto',
        })
      }
    }
  } catch (err) {
    console.error('[heartbeat] update-check error:', err)
  }
}
