import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getT } from '@/lib/i18n/server'
import { decryptSecret } from '@/lib/security/secretbox'
import { keyMaterial } from '@/lib/security/keys'
import { autoPostPage, buildLoginToken, loginClaims, loginUrl } from '@/lib/wp-login/token'

export const dynamic = 'force-dynamic'

/** Alleen een formulier van de eigen app (geen link of formulier van een andere site). */
function sameOrigin(req: NextRequest): boolean {
  const fetchSite = req.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') return false
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host) return false
  try { return new URL(origin).host === host } catch { return false }
}

const KNOWN = ['forbidden', 'not_connected', 'connector_outdated', 'sso_disabled', 'no_admin', 'rate_limited', 'insecure_url', 'mfa_required']

/**
 * "Inloggen in WP Admin": de database controleert rechten en kiest de beheerder (start_wp_login),
 * de app ondertekent een token van 60 s met het site-secret, en de browser post het naar de site.
 * Alleen POST vanaf de eigen app (Origin), nooit via een link van buiten.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Relatief terug naar de sitepagina (achter een proxy is req.url niet altijd het publieke adres).
  const back = (code: string) => new NextResponse(null, { status: 303, headers: { location: `/sites/${id}?wp_login=${code}` } })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return back('forbidden')
  if (!sameOrigin(req)) return new NextResponse('Forbidden', { status: 403 })

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('start_wp_login', { p_site: id })
  const row = Array.isArray(data) ? data[0] : null
  if (error || !row) {
    const code = KNOWN.find(k => error?.message?.includes(k)) ?? 'failed'
    if (code === 'failed') console.error('[wp-login] start_wp_login mislukt', error?.message)
    return back(code)
  }
  const admin = createAdminClient()
  const { data: cred } = await admin.from('site_credentials').select('secret_ciphertext').eq('site_id', id).single()
  if (!cred?.secret_ciphertext) return back('not_connected')
  let secret: string
  try { secret = decryptSecret(cred.secret_ciphertext, keyMaterial()) } catch (e) { console.error('[wp-login] secret niet te openen', (e as Error).message); return back('failed') }

  const token = buildLoginToken(loginClaims({ site: id, aud: row.site_url, user: row.wp_user_id, by: row.user_email, nonce: row.nonce }), secret)
  const t = await getT()
  return new NextResponse(autoPostPage({ action: loginUrl(row.site_url), token, title: t('wpLogin.redirecting', { user: row.wp_user_login }), button: t('wpLogin.continue') }), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
    },
  })
}
