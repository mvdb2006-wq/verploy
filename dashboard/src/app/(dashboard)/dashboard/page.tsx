import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { timeAgo, statusDot, cn, sslSeverity, phpSeverity, vitalsGrade, vitalsColor } from '@/lib/utils'
import type { SiteOverview } from '@/types'
import {
  Globe,
  ShieldAlert,
  RefreshCw,
  Zap,
  Plus,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'

export const metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('agency_members')
    .select('agency_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return (
      <div className="p-8 text-center text-muted">
        Geen agency gevonden. Neem contact op met support.
      </div>
    )
  }

  const { data: sites } = await supabase
    .from('site_overview')
    .select('*')
    .eq('agency_id', membership.agency_id)
    .order('status', { ascending: true })

  const rows = (sites ?? []) as SiteOverview[]

  // Stats
  const total   = rows.length
  const online  = rows.filter(s => s.status === 'online').length
  const offline = rows.filter(s => s.status === 'offline').length
  const updates = rows.reduce((n, s) => n + (s.pending_updates ?? 0), 0)

  const alerts  = rows.reduce((n, s) => n + (s.critical_alerts ?? 0), 0)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="section-label mb-1">Overzicht</p>
          <h1 className="text-2xl font-extrabold text-text tracking-tight">Dashboard</h1>
        </div>
        <Link href="/settings/sites/new" className="btn btn-primary">
          <Plus size={15} />
          Site toevoegen
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Totaal sites" value={total} icon={<Globe size={18} className="text-accent" />} />
        <StatCard
          label="Online"
          value={online}
          icon={<CheckCircle2 size={18} className="text-accent" />}
          accent
        />
        <StatCard
          label="Updates beschikbaar"
          value={updates}
          icon={<RefreshCw size={18} className={updates > 0 ? 'text-warn' : 'text-muted'} />}
          warn={updates > 0}
        />
        <StatCard
          label="Kritieke meldingen"
          value={alerts}
          icon={<ShieldAlert size={18} className={alerts > 0 ? 'text-danger' : 'text-muted'} />}
          danger={alerts > 0}
        />
      </div>

      {/* Sites table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-bold text-text">Sites</h2>
          <span className="text-xs text-muted">{total} site{total !== 1 ? 's' : ''}</span>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Globe size={32} className="text-border mx-auto mb-3" />
            <p className="text-sm font-semibold text-muted mb-1">Nog geen sites</p>
            <p className="text-xs text-subtle mb-4">Installeer de Verploy connector plugin op je eerste WordPress-site.</p>
            <Link href="/settings/sites/new" className="btn btn-primary">
              <Plus size={14} />
              Site toevoegen
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface2/50">
                  <th className="text-left px-5 py-3 text-[11px] font-bold uppercase tracking-widest text-muted">Site</th>
                  <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted">Status</th>
                  <th className="text-right px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted">Updates</th>
                  <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted">PHP</th>
                  <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted">SSL</th>
                  <th className="text-right px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted">Vitals</th>
                  <th className="text-right px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted">Gezien</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(site => (
                  <SiteRow key={site.id} site={site} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SiteRow({ site }: { site: SiteOverview }) {
  const sslDays  = site.ssl_days_remaining
  const phpMajor = site.php_version?.split('.').slice(0, 1 + 1).join('.') ?? null
  const sslSev   = sslSeverity(sslDays)
  const phpSev   = phpSeverity(phpMajor)
  const grade    = vitalsGrade(site.performance_score)
  const gradeColor = vitalsColor(site.performance_score)

  const statusColors: Record<string, string> = {
    online:   'bg-accent',
    offline:  'bg-danger',
    degraded: 'bg-warn',
    unknown:  'bg-muted',
  }

  const statusLabels: Record<string, string> = {
    online:   'Online',
    offline:  'Offline',
    degraded: 'Verslechterd',
    unknown:  'Onbekend',
  }

  return (
    <tr className="hover:bg-surface2/50 transition-colors group">
      <td className="px-5 py-3.5">
        <div>
          <p className="font-semibold text-text">{site.name}</p>
          <p className="text-xs text-subtle truncate max-w-[200px]">{site.url}</p>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <span className="status-dot">
          <span className={cn('w-1.5 h-1.5 rounded-full inline-block', statusColors[site.status ?? 'unknown'])} />
          <span className="text-text">{statusLabels[site.status ?? 'unknown']}</span>
        </span>
      </td>
      <td className="px-4 py-3.5 text-right">
        {(site.pending_updates ?? 0) > 0 ? (
          <span className="badge badge-warn">{site.pending_updates}</span>
        ) : (
          <span className="text-muted text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-3.5">
        {phpMajor ? (
          <span className={cn('text-sm font-mono font-semibold', {
            'text-danger': phpSev === 'danger',
            'text-warn':   phpSev === 'warn',
            'text-accent': phpSev === 'ok',
          })}>
            {phpMajor}
          </span>
        ) : (
          <span className="text-muted text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-3.5">
        {sslDays !== null ? (
          <span className={cn('text-sm font-semibold', {
            'text-danger': sslSev === 'danger',
            'text-warn':   sslSev === 'warn',
            'text-accent': sslSev === 'ok',
          })}>
            {sslDays}d
          </span>
        ) : (
          <span className="text-muted text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-3.5 text-right">
        <span className={cn('text-sm font-bold', gradeColor)}>{grade}</span>
      </td>
      <td className="px-4 py-3.5 text-right text-xs text-muted tabular-nums">
        {timeAgo(site.last_seen_at)}
      </td>
      <td className="px-4 py-3.5">
        <Link
          href={`/sites/${site.id}`}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-text"
        >
          <ArrowUpRight size={15} />
        </Link>
      </td>
    </tr>
  )
}

function StatCard({
  label, value, icon, accent, warn, danger,
}: {
  label: string
  value: number
  icon: React.ReactNode
  accent?: boolean
  warn?: boolean
  danger?: boolean
}) {
  return (
    <div className="card py-4">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold text-muted">{label}</p>
        {icon}
      </div>
      <p className={cn('text-3xl font-extrabold tabular-nums', {
        'text-accent': accent,
        'text-warn':   warn && !danger,
        'text-danger': danger,
        'text-text':   !accent && !warn && !danger,
      })}>
        {value}
      </p>
    </div>
  )
}
