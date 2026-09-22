import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as string | null
  const next = searchParams.get('next') ?? '/dashboard'

  const supabase = createClient()

  // PKCE flow: exchange authorization code for session
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/auth/update-password`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // OTP / token_hash flow (invite, recovery via email link)
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'recovery' | 'invite' | 'email' | 'signup' | 'magiclink',
    })
    if (!error) {
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/auth/update-password`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // All other cases: redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth-callback-error`)
}
