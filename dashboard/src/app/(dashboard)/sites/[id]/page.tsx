import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { timeAgo, cn, sslSeverity, phpSeverity, vitalsGrade, vitalsColor } from '@/lib/utils'
import type { Alert } from '@/types'
import {
  ArrowLeft,
  Globe,
  RefreshCw,
  AlertTriangle,
  Clock,
  Zap,
  Package,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react'

export const metadata = { title: 'Site detail' }

export default async function SiteDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('agency_members')
    .select('agency_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) redirect('/dashboard')

  // Fetch site
  const { data: site } = await supabase
    .from('sites')
    .select('id, name, url, client_name, status, last_seen_at, last_heartbeat_at, wp_version, php_version, created_at')
    .eq('id', params.id)
    .eq('agency_id', membership.agency_id)
    .single()

  if (!site) notFound()

  // Fetch latest health snapshot
  const { data: snapshots } = await supabase
    .from('health_snapshots')
    .select('captured_at, wp_version, php_version, ssl_valid, ssl_days_remaining, ssl_issuer, mysql_version, opscache_enabled, memory_limit_mb, performance_score, lcp_ms, cls_score, fid_ms, ttfb_ms, db_size_mb')
    .eq('site_id', site.id)
    .order('captured_at', { ascending: false })
    .limit(1)

  const snap = snapshots?.[0] ?? null

  // Plugins (active, updates first)
  const { data: plugins } = await supabase
    .from('site_plugins')
    .select('id, name, slug, version, latest_version, update_available, active, vulnerable')
    .eq('site_id', site.id)
    .eq('active', true)
    .order('update_available', { ascending: false })
    .order('name')
    .limit(50)

  // Recent update runs
  const { data: runs } = await supabase
    .from('update_runs')
    .select('id, status, plugin_slugs, plugin_count, queued_at, finished_at, test_passed, error_message')
    .eq('site_id', site.id)
    .order('queued_at', { ascending: false })
    .limit(10)

  // Recent alerts
  const { data: alerts } = await supabase
    .from('alerts')
    .select('id, type, severity, status, title, message, triggered_at, resolved_at')
    .eq('site_id', site.id)
    .order('triggered_at', { ascending: false })
    .limit(5)

  const phpMajor   = (snap?.php_version ?? site.php_version)?.split('.').slice(0, 2).join('.') ?? null
  const sslSev     = sslSeverity(snap?.ssl_days_remaining ?? null)
  const phpSev     = phpSeverity(phpMajor)
  const grade      = vitalsGrade(snap?.performance_score ?? null)
  const gradeColor = vitalsColor(snap?.performance_score ?? null)

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

  const pendingUpdates = (plugins ?? []).filter(p => p.update_available).length
  const openAlerts     = (alerts ?? []).filter(a => a.status === 'open').length

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Back */}
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text mb-5 transition-colors">
        <ArrowLeft size={14} />
        Terug naar dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="status-dot">
              <span className={cn('w-2 h-2 rounded-full', statusColors[site.status ?? 'unknown'])} />
              <span className="text-sm text-muted">{statusLabels[site.status ?? 'unknown']}</span>
            </span>
          </div>
          <h1 className="text-2xl font-extrabold text-text tracking-tight truncate">{site.name}</h1>
          <a
            href={site.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted hover:text-accent transition-colors flex items-center gap-1 mt-0.5"
          >
            <Globe size={13} />
            {site.url}
          </a>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs text-muted">Laatste heartbeat</p>
          <p className="text-sm font-semibold text-text">{timeAgo(site.last_heartbeat_at)}</p>
          {pendingUpdates > 0 && (
            <span className="badge badge-warn mt-1">{pendingUpdates} update{pendingUpdates !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      {/* Health tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <InfoTile label="PHP versie" value={phpMajor ?? '—'} severity={phpSev} mono />
        <InfoTile
          label="SSL geldig"
          value={snap?.ssl_days_remaining != null ? `${snap.ssl_days_remaining} dagen` : '—'}
          severity={sslSev}
        />
        <InfoTile label="WordPress" value={(snap?.wp_version ?? site.wp_version) ?? '—'} mono />
        <div className="card py-4">
          <p className="text-xs font-semibold text-muted mb-3">Vitals score</p>
          <p className={cn('text-3xl font-extrabold', gradeColor)}>{grade}</p>
          {snap?.performance_score != null && (
            <p className="text-xs text-muted mt-1">{snap.performance_score}/100</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plugins */}
        <section className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package size={15} className="text-accent" />
              <h2 className="font-bold text-text">Plugins</h2>
            </div>
            {pendingUpdates > 0 && (
              <span className="badge badge-warn">{pendingUpdates} update{pendingUpdates !== 1 ? 's' : ''}</span>
            )}
          </div>
          <div className="divide-y divide-border max-h-72 overflow-y-auto">
            {(plugins ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Geen plugin-data beschikbaar.</p>
            ) : (
              (plugins ?? []).map(plugin => (
                <div key={plugin.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate">{plugin.name}</p>
                    <p className="text-xs text-subtle font-mono">{plugin.version}</p>
                  </div>
                  {plugin.update_available && plugin.latest_version && (
                    <span className="badge badge-warn flex-shrink-0">→ {plugin.latest_version}</span>
                  )}
                  {plugin.vulnerable && (
                    <span className="badge badge-danger flex-shrink-0">kwetsbaar</span>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* Update runs */}
        <section className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <RefreshCw size={15} className="text-accent" />
            <h2 className="font-bold text-text">Update-runs</h2>
          </div>
          <div className="divide-y divide-border max-h-72 overflow-y-auto">
            {(runs ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Nog geen updates uitgevoerd.</p>
            ) : (
              (runs ?? []).map((run: {
                id: string; status: string; plugin_slugs: string[]
                plugin_count: number | null; queued_at: string
                finished_at: string | null; test_passed: boolean | null; error_message: string | null
              }) => (
                <div key={run.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate">
                      {(run.plugin_slugs ?? []).join(', ') || 'Onbekend'}
                    </p>
                    <p className="text-xs text-subtle">{timeAgo(run.queued_at)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <RunStatusBadge status={run.status} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Web Vitals */}
        {snap && (
          <section className="card">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={15} className="text-accent" />
              <h2 className="font-bold text-text">Core Web Vitals</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <VitalTile label="LCP" value={snap.lcp_ms != null ? `${snap.lcp_ms}ms` : '—'} ok={snap.lcp_ms != null && snap.lcp_ms < 2500} />
              <VitalTile label="CLS" value={snap.cls_score != null ? Number(snap.cls_score).toFixed(3) : '—'} ok={snap.cls_score != null && snap.cls_score < 0.1} />
              <VitalTile label="FID" value={snap.fid_ms != null ? `${snap.fid_ms}ms` : '—'} ok={snap.fid_ms != null && snap.fid_ms < 100} />
              <VitalTile label="TTFB" value={snap.ttfb_ms != null ? `${snap.ttfb_ms}ms` : '—'} ok={snap.ttfb_ms != null && snap.ttfb_ms < 800} />
            </div>
          </section>
        )}

        {/* Recent alerts */}
        <section className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-accent" />
              <h2 className="font-bold text-text">Recente meldingen</h2>
            </div>
            {openAlerts > 0 && <span className="badge badge-danger">{openAlerts}</span>}
          </div>
          <div className="divide-y divide-border">
            {(alerts ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Geen meldingen.</p>
            ) : (
              (alerts as Alert[]).map(alert => (
                <div key={alert.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-text">{alert.title}</p>
                    <span className={cn('badge flex-shrink-0', {
                      'badge-danger': alert.severity === 'critical',
                      'badge-warn':   alert.severity === 'warning',
                      'badge-muted':  alert.severity === 'info',
                    })}>
                      {alert.severity}
                    </span>
                  </div>
                  {alert.message && (
                    <p className="text-xs text-subtle mt-0.5">{alert.message}</p>
                  )}
                  <p className="text-xs text-subtle mt-0.5">{timeAgo(alert.triggered_at)}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function InfoTile({ label, value, severity, mono }: {
  label: string
  value: string
  severity?: 'ok' | 'warn' | 'danger'
  mono?: boolean
}) {
  return (
    <div className="card py-4">
      <p className="text-xs font-semibold text-muted mb-3">{label}</p>
      <p className={cn('text-xl font-bold', mono && 'font-mono', {
        'text-accent': severity === 'ok',
        'text-warn':   severity === 'warn',
        'text-danger': severity === 'danger',
        'text-text':   !severity,
      })}>
        {value}
      </p>
    </div>
  )
}

function VitalTile({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="bg-surface2 rounded-lg px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">{label}</p>
      <p className={cn('text-base font-bold font-mono', ok ? 'text-accent' : 'text-warn')}>{value}</p>
    </div>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  const config: Record<string, { cls: string; label: string; icon?: React.ReactNode }> = {
    queued:      { cls: 'badge-muted', label: 'In wachtrij', icon: <Clock size={10} /> },
    staging:     { cls: 'badge-warn', label: 'Staging...',   icon: <Loader2 size={10} className="animate-spin" /> },
    testing:     { cls: 'badge-warn', label: 'Testen...',    icon: <Loader2 size={10} className="animate-spin" /> },
    passed:      { cls: 'badge-accent', label: 'Geslaagd',   icon: <CheckCircle2 size={10} /> },
    failed:      { cls: 'badge-danger', label: 'Mislukt',    icon: <XCircle size={10} /> },
    deployed:    { cls: 'badge-accent', label: 'Geïnstalleerd', icon: <CheckCircle2 size={10} /> },
    rolled_back: { cls: 'badge-danger', label: 'Teruggedraaid', icon: <XCircle size={10} /> },
  }
  const c = config[status] ?? { cls: 'badge-muted', label: status }
  return (
    <span className={cn('badge gap-1', c.cls)}>
      {c.icon}
      {c.label}
    </span>
  )
}
