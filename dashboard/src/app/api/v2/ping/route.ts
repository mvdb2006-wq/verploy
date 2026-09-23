import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateSigned } from '@/lib/connector/auth'
import { json } from '@/lib/connector/http'

export const dynamic = 'force-dynamic'

/** GET /api/v2/ping — verbindingstest vanuit de plugin (gesigneerd, lege body). */
export async function GET(req: Request) {
  const admin = createAdminClient()
  const auth = await authenticateSigned(admin, req, '')
  if (!auth.ok) return json({ error: 'unauthorized', reason: auth.reason }, 401)
  const { data: site } = await admin.from('sites').select('name, url').eq('id', auth.siteId).single()
  return json({ ok: true, site: site ?? null })
}
