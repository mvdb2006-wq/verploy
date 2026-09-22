import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Legacy ping endpoint — kept for backward compatibility with older plugin versions.
 * Accepts a simple JSON body with api_key and basic WP metadata.
 * New connector plugin uses /api/v1/sites/heartbeat instead.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { api_key, wp_version, php_version, plugins, theme, site_url } = body

    if (!api_key) {
      return NextResponse.json({ error: 'Missing api_key' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Find site by API key
    const { data: site, error } = await supabase
      .from('sites')
      .select('id, agency_id')
      .eq('api_key', api_key)
      .eq('active', true)
      .single()

    if (error || !site) {
      return NextResponse.json({ error: 'Invalid api_key' }, { status: 401 })
    }

    const now = new Date().toISOString()

    // Insert health snapshot (minimal data from legacy ping)
    const { error: snapError } = await supabase
      .from('health_snapshots')
      .insert({
        site_id:    site.id,
        captured_at: now,
        wp_version:  wp_version  ?? null,
        php_version: php_version ?? null,
        status_code: 200,
        raw_data: { api_key: '[redacted]', wp_version, php_version, theme, site_url },
      })

    if (snapError) {
      console.error('[verploy ping] snapshot error:', snapError)
      // Non-fatal — continue to update site status
    }

    // Upsert plugins if provided as strings (old format: ["plugin/plugin.php", ...])
    if (Array.isArray(plugins) && plugins.length > 0 && typeof plugins[0] === 'string') {
      const pluginRows = (plugins as string[]).map(file => ({
        site_id: site.id,
        slug:    file,
        name:    file.split('/')[0] ?? file,
        active:  true,
        update_available: false,
        vulnerable: false,
      }))
      await supabase
        .from('site_plugins')
        .upsert(pluginRows, { onConflict: 'site_id,slug' })
    }

    // Update site status
    const { error: updateError } = await supabase
      .from('sites')
      .update({
        status:           'online',
        last_seen_at:     now,
        last_heartbeat_at: now,
        wp_version:       wp_version  ?? null,
        php_version:      php_version ?? null,
        updated_at:       now,
      })
      .eq('id', site.id)

    if (updateError) {
      console.error('[verploy ping] update error:', updateError)
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[verploy ping] error:', err)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
