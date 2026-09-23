import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'

/** Logo van het eigen bureau (privé-bucket); alleen voor ingelogde leden. */
export async function GET() {
  const session = await getSession()
  const path = session?.agency?.brand_logo_path
  if (!session?.agency || !path || !path.startsWith(`${session.agency.id}/`)) return new NextResponse(null, { status: 404 })
  const { data, error } = await createAdminClient().storage.from('branding').download(path)
  if (error || !data) return new NextResponse(null, { status: 404 })
  const ext = path.split('.').pop()
  return new NextResponse(Buffer.from(await data.arrayBuffer()), {
    headers: { 'content-type': ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' },
  })
}
