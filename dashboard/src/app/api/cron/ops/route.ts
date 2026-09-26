import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkOps } from '@/lib/ops/alerts'
import { sendSignupNotices } from '@/lib/ops/signups'
import { sendEmail } from '@/lib/email'
import { json } from '@/lib/connector/http'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * POST /api/cron/ops — alarm voor de beheerder (zie src/lib/ops/alerts.ts). Aangeroepen door Supabase
 * (pg_cron + pg_net, elke 5 minuten) met het token uit ops_config; CRON_SECRET werkt ook.
 */
async function handle(req: Request) {
  const admin = createAdminClient()
  const given = req.headers.get('authorization') ?? ''
  const { data: config } = await admin.from('ops_config').select('cron_token').maybeSingle()
  const secret = env().CRON_SECRET
  const ok = (config?.cron_token && same(given, `Bearer ${config.cron_token}`)) || (secret && same(given, `Bearer ${secret}`))
  if (!ok) return json({ error: 'unauthorized' }, 401)
  const result = await checkOps(admin, (to, mail) => sendEmail({ to, ...mail, idempotencyKey: `ops-${to}-${Math.floor(Date.now() / 60_000)}` }))
  // Nieuwe registraties: los van het alarm, zodat een fout in het ene het andere niet tegenhoudt.
  const signups = await sendSignupNotices(admin, (to, mail, key) => sendEmail({ to, ...mail, idempotencyKey: key }))
    .catch(e => { console.error('[ops] registratiemeldingen mislukt', (e as Error).message); return { pending: 0, sent: 0 } })
  return json({ ok: true, ...result, signups })
}
export const POST = handle
export const GET = handle
