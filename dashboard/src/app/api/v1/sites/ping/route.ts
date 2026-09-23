import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/v1/sites/ping
 * Used by the WordPress connector plugin to test the API key connection.
 * Auth: Authorization: Bearer <api_key>
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const api_key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''

  if (!api_key) {
    return NextResponse.json({ message: 'Missing API key' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const { data: site, error } = await supabase
    .from('sites')
    .select('id, name, url, status')
    .eq('api_key', api_key)
    .maybeSingle()

  if (error || !site) {
    return NextResponse.json({ message: 'Invalid API key' }, { status: 401 })
  }

  return NextResponse.json({
    ok: true,
    site: {
      id:     site.id,
      name:   site.name,
      url:    site.url,
      status: site.status,
    },
  })
}
