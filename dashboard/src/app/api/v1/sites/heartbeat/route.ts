import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendAlertEmail } from '@/lib/email'

// ─── Types ────────────────────────────────────────────────────────────────────

interface IncomingPayload {
  collected_at: string
  connector_version?: string
  site?: { url?: string; name?: string; admin_email?: string; language?: string; timezone?: string; multisite?: boolean }
  server?: {
    php_version?: string; php_major?: string; mysql_version?: string
    memory_limit?: string; max_execution_time?: number
    opcache?: { enabled?: boolean; hit_rate?: number | null }
  }
  wordpress?: {
    version?: string; core_update_available?: string | null
    ssl?: { enabled?: boolean; expires_days?: number | null; issuer?: string | null; valid_from?: string | null }
  }
  plugins?: Array<{
    file?: string; name?: string; version?: string
    active?: boolean; update_available?: boolean; update_version?: string | null
  }>
  themes?: Array<{
    slug?: string; name?: string; version?: string
    active?: boolean; update_available?: boolean; update_version?: string | null
  }>
  performance?: { db_response_ms?: number; uploads_size_mb?: number; active_plugins_count?: number }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse PHP memory_limit string like "256M", "1G", "512K" → integer MB */
function parseMemoryMb(limit: string | undefined): number | null {
  if (!limit) return null
  const n = parseInt(limit)
  if (isNaN(n)) return null
  const unit = limit.slice(-1).toUpperCase()
  if (unit === 'G') return n * 1024
  if (unit === 'K') return Math.round(n / 1024)
  return n // assume MB
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate via Bearer token
    const auth = req.headers.get('authorization') ?? ''
    const api_key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null

    if (!api_key) {
      return NextResponse.json({ error: 'Missing API key — send Authorization: Bearer <key>' }, { status: 401 })
    }

    const body = (await req.json()) as IncomingPayload

    const supabase = createServiceClient()

    // 2. Find site by API key (also grab name + url for alert emails)
    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('id, agency_id, name, url')
      .eq('api_key', api_key)
      .eq('active', true)
      .single()

    if (siteError || !site) {
      return NextResponse.json({ error: 'Invalid or unknown API key' }, { status: 401 })
    }

    const now = new Date()
    const wp      = body.wordpress ?? {}
    const server  = body.server    ?? {}
    const perf    = body.performance ?? {}
    const ssl     = wp.ssl ?? {}

    // 3. Compute ssl_expires_at from expires_days
    const sslExpiresAt = (ssl.expires_days != null)
      ? new Date(now.getTime() + ssl.expires_days * 24 * 60 * 60 * 1000).toISOString()
      : null

    const memoryMb = parseMemoryMb(server.memory_limit)

    // 4. Insert health snapshot
    const { data: snapshot, error: snapError } = await supabase
      .from('health_snapshots')
      .insert({
        site_id:          site.id,
        captured_at:      body.collected_at ?? now.toISOString(),
        wp_version:       wp.version        ?? null,
        php_version:      server.php_version ?? null,
        ssl_valid:        ssl.enabled        ?? null,
        ssl_expires_at:   sslExpiresAt,
        ssl_issuer:       ssl.issuer         ?? null,
        uptime_ms:        null,
        status_code:      200,
        lcp_ms:           null,
        cls_score:        null,
        fid_ms:           null,
        ttfb_ms:          null,
        performance_score: null,
        mysql_version:    server.mysql_version ?? null,
        db_size_mb:       perf.uploads_size_mb ?? null,
        opscache_enabled: server.opcache?.enabled ?? null,
        memory_limit_mb:  memoryMb,
        raw_data:         body as unknown as Record<string, unknown>,
      })
      .select('id')
      .single()

    if (snapError || !snapshot) {
      console.error('[verploy heartbeat] snapshot error:', snapError)
      return NextResponse.json({ error: 'Failed to store snapshot' }, { status: 500 })
    }

    // 5. Upsert plugins
    if (Array.isArray(body.plugins) && body.plugins.length > 0) {
      const pluginRows = body.plugins.map(p => ({
        site_id:          site.id,
        slug:             p.file    ?? 'unknown',
        name:             p.name    ?? 'Unknown plugin',
        version:          p.version ?? null,
        latest_version:   p.update_version ?? null,
        update_available: p.update_available ?? false,
        active:           p.active  ?? true,
        vulnerable:       false,
        last_checked_at:  now.toISOString(),
      }))

      const { error: pluginError } = await supabase
        .from('site_plugins')
        .upsert(pluginRows, { onConflict: 'site_id,slug' })

      if (pluginError) {
        console.error('[verploy heartbeat] plugin upsert error:', pluginError)
        // Non-fatal — continue
      }
    }

    // 6. Update site status + metadata
    const { error: updateError } = await supabase
      .from('sites')
      .update({
        status:             'online',
        last_seen_at:       now.toISOString(),
        last_ping_at:       now.toISOString(),
        last_heartbeat_at:  now.toISOString(),
        wp_version:         wp.version          ?? null,
        php_version:        server.php_version  ?? null,
        connector_version:  body.connector_version ?? null,
        updated_at:         now.toISOString(),
      })
      .eq('id', site.id)

    if (updateError) {
      console.error('[verploy heartbeat] site update error:', updateError)
      return NextResponse.json({ error: 'Failed to update site' }, { status: 500 })
    }

    // 7. Auto-alerts + emails (fire-and-forget, non-fatal)
    await createAutoAlerts(supabase, site.id, site.agency_id, site.name, site.url, wp, server, ssl, sslExpiresAt)

    // 8. Fetch pending update jobs for this site
    const { data: pendingJobs } = await supabase
      .from('update_jobs')
      .select('id, type, slug, name, to_version')
      .eq('site_id', site.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    // Mark fetched jobs as 'running' so they aren't re-sent on the next heartbeat
    if (pendingJobs && pendingJobs.length > 0) {
      await supabase
        .from('update_jobs')
        .update({ status: 'running', started_at: now.toISOString() })
        .in('id', pendingJobs.map(j => j.id))
    }

    return NextResponse.json({
      ok: true,
      site_id: site.id,
      snapshot_id: snapshot.id,
      pending_jobs: pendingJobs ?? [],
    })
  } catch (err) {
    console.error('[verploy heartbeat] unexpected error:', err)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}

// ─── Alert helper ─────────────────────────────────────────────────────────────

async function createAutoAlerts(
  supabase: ReturnType<typeof createServiceClient>,
  siteId: string,
  agencyId: string,
  siteName: string,
  siteUrl: string,
  wp: IncomingPayload['wordpress'],
  server: IncomingPayload['server'],
  ssl: NonNullable<NonNullable<IncomingPayload['wordpress']>['ssl']>,
  sslExpiresAt: string | null,
) {
  // Fetch agency owner email once for notifications
  const ownerEmail = await getAgencyOwnerEmail(supabase, agencyId)
  const dashboardUrl = `https://app.verploy.com/sites/${siteId}`

  const alerts: {
    site_id: string; agency_id: string
    severity: 'critical' | 'warning' | 'info'
    type: string; title: string; message?: string
  }[] = []
  const emailsToSend: Array<() => Promise<unknown>> = []

  // SSL expiry alert
  if (sslExpiresAt !== null && ssl.expires_days != null) {
    const days = ssl.expires_days
    if (days <= 14) {
      const { data: existing } = await supabase
        .from('alerts')
        .select('id')
        .eq('site_id', siteId)
        .eq('type', 'ssl_expiry')
        .eq('status', 'open')
        .limit(1)

      if (!existing?.length) {
        alerts.push({
          site_id: siteId, agency_id: agencyId,
          severity: days <= 3 ? 'critical' : 'warning',
          type: 'ssl_expiry',
          title: `SSL-certificaat verloopt over ${days} dag${days === 1 ? '' : 'en'}`,
          message: `Het SSL-certificaat verloopt op ${new Date(sslExpiresAt).toLocaleDateString('nl-NL')}.`,
        })
        if (ownerEmail) {
          emailsToSend.push(() => sendAlertEmail(ownerEmail, {
            severity: days <= 3 ? 'critical' : 'warning',
            title: `SSL verloopt over ${days} dag${days === 1 ? '' : 'en'} — ${siteName}`,
            message: `Het SSL-certificaat verloopt binnenkort. Verleng het zo snel mogelijk om downtime te voorkomen.`,
            siteUrl,
          }))
        }
      }
    }
  }

  // PHP version alert (< 8.1 = warning, < 8.0 = critical)
  const phpVersion = server?.php_version
  if (phpVersion) {
    const [major, minor] = phpVersion.split('.').map(Number)
    if (!isNaN(major) && (major < 8 || (major === 8 && (minor ?? 0) < 1))) {
      const { data: existing } = await supabase
        .from('alerts')
        .select('id')
        .eq('site_id', siteId)
        .eq('type', 'php_version')
        .eq('status', 'open')
        .limit(1)

      if (!existing?.length) {
        alerts.push({
          site_id: siteId, agency_id: agencyId,
          severity: major < 8 ? 'critical' : 'warning',
          type: 'php_version',
          title: `PHP ${phpVersion} is verouderd`,
          message: 'WordPress vereist minimaal PHP 8.1. Update zo snel mogelijk.',
        })
        if (ownerEmail) {
          emailsToSend.push(() => sendAlertEmail(ownerEmail, {
            severity: major < 8 ? 'critical' : 'warning',
            title: `PHP ${phpVersion} is verouderd — ${siteName}`,
            message: `WordPress vereist minimaal PHP 8.1. Update PHP bij je hosting provider.`,
            siteUrl,
          }))
        }
      }
    }
  }

  if (alerts.length > 0) {
    const { error } = await supabase.from('alerts').insert(alerts)
    if (error) {
      console.error('[verploy heartbeat] alert insert error:', error)
      return // don't send emails if alert insert failed
    }
    // Send emails after successful insert
    await Promise.all(emailsToSend.map(fn => fn().catch(console.error)))
  }
}

/** Get the email address of the agency owner from auth.users via service client */
async function getAgencyOwnerEmail(
  supabase: ReturnType<typeof createServiceClient>,
  agencyId: string,
): Promise<string | null> {
  try {
    const { data: agency } = await supabase
      .from('agencies')
      .select('owner_id')
      .eq('id', agencyId)
      .single()

    if (!agency?.owner_id) return null

    const { data: { user } } = await supabase.auth.admin.getUserById(agency.owner_id)
    return user?.email ?? null
  } catch {
    return null
  }
}
