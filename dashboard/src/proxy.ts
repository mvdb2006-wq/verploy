import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { LOCALE_COOKIE } from '@/lib/i18n/core'
import { entryLocale, normalizePlanParam } from '@/lib/signup-intent'
import { resilientFetch } from '@/lib/supabase/fetch'

const proxyFetch = resilientFetch()

const PUBLIC_PREFIXES = ['/login', '/signup', '/forgot-password', '/auth/', '/invite/', '/api/']

/** Ververst de Supabase-sessie en stuurt niet-ingelogde bezoekers naar /login. */
export async function proxy(request: NextRequest) {
  // Taal van het instappunt (?lang=, of: komt van verploy.com). Een expliciete ?lang= wint altijd; de
  // herkomst alleen als er nog geen taalkeuze is. Daarna blijft de keuze bewaard (cookie, later het bureau).
  const lang = request.nextUrl.searchParams.get('lang')
  const current = request.cookies.get(LOCALE_COOKIE)?.value
  const entry = entryLocale(lang, current ? null : request.headers.get('referer'))
  const setLocale = entry && entry !== current ? entry : null
  if (setLocale) request.cookies.set(LOCALE_COOKIE, setLocale)
  const withLocale = <R extends NextResponse>(res: R): R => {
    if (setLocale) res.cookies.set(LOCALE_COOKIE, setLocale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', httpOnly: true })
    return res
  }

  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: proxyFetch },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: toSet => {
          for (const { name, value } of toSet) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options)
        },
      },
    },
  )
  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PREFIXES.some(p => path.startsWith(p))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = path === '/' ? '' : `?next=${encodeURIComponent(path + request.nextUrl.search)}`
    return withLocale(NextResponse.redirect(url))
  }
  if (user && (path === '/login' || path === '/signup')) {
    // Al ingelogd en een plan gekozen op verploy.com: meteen naar het abonnement, met dat plan voorgeselecteerd.
    const plan = path === '/signup' ? normalizePlanParam(request.nextUrl.searchParams.get('plan')) : null
    const url = request.nextUrl.clone()
    url.pathname = plan ? '/settings/billing' : '/'
    url.search = plan ? `?plan=${plan}` : ''
    return withLocale(NextResponse.redirect(url))
  }
  return withLocale(response)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|downloads/|api/v1/plugin|api/v2/).*)'],
}
