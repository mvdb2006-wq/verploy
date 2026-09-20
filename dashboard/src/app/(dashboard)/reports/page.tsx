import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { timeAgo, cn } from '@/lib/utils'
import type { Report } from '@/types'
import { FileText, Download, Clock, CheckCircle2, Loader2 } from 'lucide-react'

export const metadata = { title: 'Rapporten' }

export default async function ReportsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('agency_members')
    .select('agency_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) redirect('/dashboard')

  const { data: reports } = await supabase
    .from('reports')
    .select('*, sites(id, name)')
    .eq('agency_id', membership.agency_id)
    .order('generated_at', { ascending: false })
    .limit(50)

  const rows = (reports ?? []) as (Report & { sites: { id: string; name: string } | null })[]

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <p className="section-label mb-1">Client reporting</p>
        <h1 className="text-2xl font-extrabold text-text tracking-tight">Rapporten</h1>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <FileText size={15} className="text-accent" />
          <h2 className="font-bold text-text">Maandrapportages</h2>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <FileText size={28} className="text-border mx-auto mb-3" />
            <p className="text-sm font-semibold text-muted">Nog geen rapporten</p>
            <p className="text-xs text-subtle mt-1">Rapporten worden automatisch maandelijks gegenereerd.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map(report => (
              <div key={report.id} className="px-5 py-3.5 flex items-center gap-3">
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', {
                  'bg-accent/10': report.status === 'ready',
                  'bg-warn/10':   report.status === 'generating',
                  'bg-danger/10': report.status === 'failed',
                  'bg-surface2':  report.status === 'queued',
                })}>
                  {report.status === 'ready'      && <CheckCircle2 size={16} className="text-accent" />}
                  {report.status === 'generating' && <Loader2 size={16} className="text-warn animate-spin" />}
                  {report.status === 'failed'     && <FileText size={16} className="text-danger" />}
                  {report.status === 'queued'     && <Clock size={16} className="text-muted" />}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text">
                    {report.sites?.name ?? 'Site rapport'} — {report.period_label ?? ''}
                  </p>
                  <p className="text-xs text-muted">{timeAgo(report.generated_at)}</p>
                </div>

                <div className="flex items-center gap-2">
                  <span className={cn('badge', {
                    'badge-ok':    report.status === 'ready',
                    'badge-warn':  report.status === 'generating',
                    'badge-danger':report.status === 'failed',
                    'badge-muted': report.status === 'queued',
                  })}>
                    {report.status === 'ready'      ? 'Gereed' :
                     report.status === 'generating' ? 'Genereren' :
                     report.status === 'failed'     ? 'Mislukt' : 'Wachtrij'}
                  </span>

                  {report.status === 'ready' && report.pdf_url && (
                    <a
                      href={report.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost py-1.5 px-3 text-xs gap-1.5"
                    >
                      <Download size={12} />
                      PDF
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
