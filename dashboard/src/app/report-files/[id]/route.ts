import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** PDF van een rapport. RLS (sessie van de gebruiker) bepaalt of hij bij het eigen bureau hoort. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 })
  const supabase = await createClient()
  const { data: report } = await supabase.from('reports').select('pdf_path, period_start, site_id').eq('id', id).maybeSingle()
  if (!report?.pdf_path) return new NextResponse(null, { status: 404 })
  const { data: site } = await supabase.from('sites').select('name').eq('id', report.site_id).maybeSingle()
  const { data, error } = await createAdminClient().storage.from('reports').download(report.pdf_path)
  if (error || !data) return new NextResponse(null, { status: 404 })
  const slug = (site?.name ?? 'site').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'site'
  return new NextResponse(Buffer.from(await data.arrayBuffer()), {
    headers: {
      'content-type': 'application/pdf',
      // ?view=1: in de browser openen (Bekijken), anders downloaden.
      'content-disposition': `${req.nextUrl.searchParams.get('view') === '1' ? 'inline' : 'attachment'}; filename="${slug}-${report.period_start.slice(0, 7)}.pdf"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
