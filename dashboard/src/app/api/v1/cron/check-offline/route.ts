import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendAlertEmail } from '@/lib/email'

// Vercel roept deze route elk uur aan via vercel.json crons.
// Sites die langer dan 2 uur niet gepingd hebben worden op 'offline' gezet,
// en er wordt een melding aangemaakt in de alerts-tabel + email verstuurd.

export async function GET(req: NextRequest) {
  // Vercel stuurt de CRON_SECRET als Authorization header
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // Sites die ooit gepingd hebben maar nu te lang stil zijn
  const { data: staleSites, error } = await supabase
    .from('sites')
    .select('id, name, url, agency_id')
    .eq('status', 'online')
    .lt('last_heartbeat_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())

  if (error) {
    console.error('[verploy cron] query error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }

  if (!staleSites || staleSites.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 })
  }

  const staleIds = staleSites.map((s: { id: string }) => s.id)

  // Mark offline
  const { error: updateError } = await supabase
    .from('sites')
    .update({ status: 'offline' })
    .in('id', staleIds)

  if (updateError) {
    console.error('[verploy cron] update error:', updateError)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }

  // For each newly offline site: create alert (if not already open) + send email
  for (const site of staleSites as { id: string; name: string; url: string; agency_id: string }[]) {
    const { data: existing } = await supabase
      .from('alerts')
      .select('id')
      .eq('site_id', site.id)
      .eq('type', 'site_down')
      .eq('status', 'open')
      .limit(1)

    if (!existing?.length) {
      await supabase.from('alerts').insert({
        site_id:    site.id,
        agency_id:  site.agency_id,
        severity:   'critical',
        type:       'site_down',
        title:      `${site.name} is offline`,
        message:    'Geen heartbeat ontvangen in de afgelopen 2 uur.',
      })

      // Send email to agency owner
      try {
        const ownerEmail = await getAgencyOwnerEmail(supabase, site.agency_id)
        if (ownerEmail) {
          await sendAlertEmail(ownerEmail, {
            severity: 'critical',
            title:    `${site.name} is offline`,
            message:  'Geen heartbeat ontvangen in de afgelopen 2 uur. Controleer of de site bereikbaar is en de connector plugin actief is.',
            siteUrl:  site.url,
          })
        }
      } catch (emailErr) {
        console.error('[verploy cron] email error for', site.name, emailErr)
      }
    }
  }

  console.log(
    `[verploy cron] ${staleSites.length} site(s) offline gezet:`,
    staleSites.map((s: { id: string; name: string }) => s.name),
  )

  return NextResponse.json({ ok: true, updated: staleSites.length })
}

/** Get the email address of the agency owner */
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
