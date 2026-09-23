import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/v1/sites/jobs/:id/complete
// Called by the WordPress connector after executing an update job.
// Body: { success: boolean; log?: string; from_version?: string; to_version?: string }

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 1. Authenticate via Bearer token
    const auth    = req.headers.get('authorization') ?? ''
    const api_key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null

    if (!api_key) {
      return NextResponse.json({ error: 'Missing API key' }, { status: 401 })
    }

    const body = await req.json() as {
      success: boolean
      log?: string
      from_version?: string
      to_version?: string
    }

    const supabase = createServiceClient()

    // 2. Verify the job exists and belongs to a site with this API key
    const { data: job, error: jobError } = await supabase
      .from('update_jobs')
      .select('id, site_id, status, sites!inner(api_key)')
      .eq('id', params.id)
      .single() as { data: { id: string; site_id: string; status: string; sites: { api_key: string } } | null; error: unknown }

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if ((job.sites as { api_key: string })?.api_key !== api_key) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 3. Update job status
    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('update_jobs')
      .update({
        status:       body.success ? 'success' : 'failed',
        result_log:   body.log    ?? null,
        from_version: body.from_version ?? null,
        to_version:   body.to_version   ?? null,
        completed_at: now,
      })
      .eq('id', params.id)

    if (updateError) {
      console.error('[verploy jobs] complete error:', updateError)
      return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[verploy jobs] unexpected error:', err)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
