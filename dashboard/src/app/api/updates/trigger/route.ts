/**
 * POST /api/updates/trigger
 * Called from the dashboard "Update now" button.
 * Creates an update_run record and dispatches it to the Railway worker.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { site_id, plugin_slugs } = await req.json()
    if (!site_id || !Array.isArray(plugin_slugs) || plugin_slugs.length === 0) {
      return NextResponse.json({ error: 'site_id and plugin_slugs required' }, { status: 400 })
    }

    // Verify user has access to this site
    const { data: site } = await supabase
      .from('sites')
      .select('id, agency_id, name')
      .eq('id', site_id)
      .single()

    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    }

    // Create the update run
    const serviceClient = createServiceClient()
    const { data: run, error: runError } = await serviceClient
      .from('update_runs')
      .insert({
        site_id,
        agency_id: site.agency_id,
        plugin_slugs,
        status: 'queued',
      })
      .select()
      .single()

    if (runError || !run) {
      return NextResponse.json({ error: 'Failed to create update run' }, { status: 500 })
    }

    // Dispatch to worker (fire-and-forget)
    const workerUrl = process.env.WORKER_URL
    if (workerUrl) {
      fetch(`${workerUrl}/run/${run.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WORKER_SECRET}`,
          'Content-Type': 'application/json',
        },
      }).catch(err => {
        console.error('[updates/trigger] Worker dispatch failed:', err.message)
        // Worker will pick it up via polling anyway
      })
    }

    return NextResponse.json({ ok: true, run_id: run.id })
  } catch (err) {
    console.error('[updates/trigger] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
