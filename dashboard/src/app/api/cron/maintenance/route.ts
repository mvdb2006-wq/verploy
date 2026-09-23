import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { runMaintenance } from '@/lib/monitoring/maintenance'
import { json } from '@/lib/connector/http'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/maintenance — drempels evalueren, SSL/domein controleren, e-mails versturen.
 * Aangeroepen door Vercel Cron (stuurt automatisch `Authorization: Bearer $CRON_SECRET`)
 * en door de worker (fase 4). Zonder CRON_SECRET is de route uitgeschakeld.
 */
export async function GET(req: Request) {
  const secret = env().CRON_SECRET
  if (!secret) return json({ error: 'cron_not_configured' }, 503)
  const given = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return json({ error: 'unauthorized' }, 401)
  const result = await runMaintenance(createAdminClient())
  return json({ ok: true, ...result })
}
