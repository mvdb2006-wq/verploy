import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Screenshots en diffs van een run. De bucket is privé: eerst controleert RLS (met de sessie
 * van de gebruiker) dat het bestand bij een testresultaat van het eigen bureau hoort; pas dan
 * haalt de server het op met de service role.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const path = req.nextUrl.searchParams.get('p') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(runId) || !path.startsWith(`${path.split('/')[0]}/${runId}/`) || path.includes('..')) {
    return new NextResponse(null, { status: 404 })
  }
  const supabase = await createClient()
  const { data: row } = await supabase.from('test_results').select('id')
    .eq('run_id', runId).or(`screenshot_path.eq.${path},diff_path.eq.${path}`).limit(1).maybeSingle()
  if (!row) return new NextResponse(null, { status: 404 })
  const { data, error } = await createAdminClient().storage.from('run-artifacts').download(path)
  if (error || !data) return new NextResponse(null, { status: 404 })
  return new NextResponse(Buffer.from(await data.arrayBuffer()), {
    headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400, immutable', 'x-content-type-options': 'nosniff' },
  })
}
