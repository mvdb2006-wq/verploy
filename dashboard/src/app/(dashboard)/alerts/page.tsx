import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { timeAgo, cn } from '@/lib/utils'
import type { Alert } from '@/types'
import { Bell, CheckCheck, AlertTriangle, Info, AlertOctagon } from 'lucide-react'

export const metadata = { title: 'Meldingen' }

export default async function AlertsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('agency_members')
    .select('agency_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) redirect('/dashboard')

  const { data: alerts } = await supabase
    .from('alerts')
    .select('*, sites(id, name, url)')
    .eq('agency_id', membership.agency_id)
    .order('triggered_at', { ascending: false })
    .limit(100)

  const rows = (alerts ?? []) as (Alert & { sites: { id: string; name: string; url: string } | null })[]

  const open = rows.filter(a => !a.resolved_at)
  const resolved = rows.filter(a => a.resolved_at)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <p className="section-label mb-1">Monitoring</p>
        <h1 className="text-2xl font-extrabold text-text tracking-tight">Meldingen</h1>
      </div>

      {/* Open alerts */}
      <div className="card p-0 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell size={15} className="text-accent" />
            <h2 className="font-bold text-text">Openstaand</h2>
          </div>
          {open.length > 0 && (
            <span className="badge badge-danger">{open.length}</span>
          )}
        </div>

        {open.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <CheckCheck size={28} className="text-accent mx-auto mb-2" />
            <p className="text-sm font-semibold text-text">Alles in orde</p>
            <p className="text-xs text-muted mt-0.5">Geen openstaande meldingen</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {open.map(alert => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>

      {/* Resolved */}
      {resolved.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-bold text-text text-sm text-muted">Opgelost ({resolved.length})</h2>
          </div>
          <div className="divide-y divide-border">
            {resolved.slice(0, 20).map(alert => (
              <AlertRow key={alert.id} alert={alert} resolved />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AlertRow({
  alert,
  resolved = false,
}: {
  alert: (Alert & { sites: { id: string; name: string; url: string } | null })
  resolved?: boolean
}) {
  const icons: Record<string, React.ReactNode> = {
    critical: <AlertOctagon size={15} className="text-danger flex-shrink-0" />,
    warning:  <AlertTriangle size={15} className="text-warn flex-shrink-0" />,
    info:     <Info size={15} className="text-muted flex-shrink-0" />,
  }

  return (
    <div className={cn('px-5 py-3.5 flex items-start gap-3', resolved && 'opacity-50')}>
      {icons[alert.severity] ?? icons.info}
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium', resolved ? 'text-muted' : 'text-text')}>{alert.message}</p>
        {alert.sites && (
          <Link
            href={`/sites/${alert.sites.id}`}
            className="text-xs text-subtle hover:text-accent transition-colors mt-0.5 inline-block"
          >
            {alert.sites.name}
          </Link>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs text-muted">{timeAgo(alert.triggered_at)}</p>
        {resolved && alert.resolved_at && (
          <p className="text-[10px] text-subtle">Opgelost {timeAgo(alert.resolved_at)}</p>
        )}
      </div>
    </div>
  )
}
