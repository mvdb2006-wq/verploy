import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { api_key, wp_version, php_version, plugins, theme, site_url } = body

    if (!api_key) {
      return NextResponse.json({ error: 'Missing api_key' }, { status: 400 })
    }

    const supabase = createClient()

    // Find site by API key (no auth needed — public endpoint)
    const { data: site, error } = await supabase
      .from('sites')
      .select('id')
      .eq('api_key', api_key)
      .single()

    if (error || !site) {
      return NextResponse.json({ error: 'Invalid api_key' }, { status: 401 })
    }

    // Update status + metadata
    const { error: updateError } = await supabase
      .from('sites')
      .update({
        status: 'online',
        last_ping_at: new Date().toISOString(),
        wp_data: {
          wp_version: wp_version ?? null,
          php_version: php_version ?? null,
          plugins: plugins ?? [],
          theme: theme ?? null,
          site_url: site_url ?? null,
        },
      })
      .eq('id', site.id)

    if (updateError) {
      console.error('[verploy] update error:', updateError)
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[verploy] ping error:', err)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
