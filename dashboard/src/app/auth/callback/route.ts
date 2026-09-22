import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function provisionAgency(userId: string, userEmail: string) {
  const service = createServiceClient()

  // Check if already provisioned
  const { data: existing } = await service
    .from('agency_members')
    .select('agency_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (existing) return

  // Build a URL-safe slug from the email prefix
  const emailPrefix = (userEmail.split('@')[0] ?? 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 20)
  const suffix = Math.random().toString(36).slice(2, 6)
  const slug = `${emailPrefix}-${suffix}`

  // Insert the agency — the DB trigger `agency_owner_member` auto-inserts
  // the agency_members row so we don't need to do it manually.
  const { error } = await service
    .from('agencies')
    .insert({ owner_id: userId, name: emailPrefix, slug })

  if (error) {
    console.error('[verploy] provisionAgency failed:', error)
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as string | null
  const next = searchParams.get('next') ?? '/dashboard'

  const supabase = createClient()

  // PKCE flow: exchange authorization code for session
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      await provisionAgency(data.user.id, data.user.email ?? '')
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/auth/update-password`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // OTP / token_hash flow (invite, recovery via email link)
  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'recovery' | 'invite' | 'email' | 'signup' | 'magiclink',
    })
    if (!error && data.user) {
      await provisionAgency(data.user.id, data.user.email ?? '')
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/auth/update-password`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // All other cases: redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth-callback-error`)
}
