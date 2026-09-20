import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { timeAgo, formatDate, cn, sslSeverity, phpSeverity, vitalsGrade, vitalsColor, runStatusLabel } from '@/lib/utils'
import type { SitePlugin, UpdateRun, Alert } from '@/types'
import {
  ArrowLeft,
  Globe,
  Shield,
  RefreshCw,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Zap,
  Package,
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

  // Fetch site + latest snapshot
  const { data: site } = await supabase
    .from('sites')
    .select(`
      *,
      health_snapshots(
        recorded_at, php_version, mysql_version, wp_version,
        ssl_valid, ssl_days_remaining, disk_free_gb,
        opcache_enabled, update_count,
        performance_score, lcp_ms, cls_score, fid_ms, ttfb_ms
      )
    `)
    .eq('id', params.id)
    .eq('agency_id', membership.agency_id)
    .order('recorded_at', { referencedTable: 'health_snapshots', ascending: false })
    .limit(1, { referencedTable: 'health_snapshots' })
    .single()

  if (!site) notFound()

  const snap = site.health_snapshots?.[0] ?? null

  // Plugins with updates
  const { data: plugins } = await supabase
    .from('site_plugins')
    .select('*')
    .eq('site_id', site.id)
    .eq('active', true)
    .order('update_available', { ascending: false })
    .order('name')
    .limit(30)

  // Recent update runs
  const { data: runs } = await supabase
    .from('update_runs')
    .select('*')
    .eq('site_id', site.id)
    .order('created_at', { ascending: false })
    .limit(10)

  // Recent alerts
  const { data: alerts } = await supabase
    .from('alerts')
    .select('*')
    .eq('site_id', site.id)
    .order('triggered_at', { ascending: false })
    .limit(5)

  const phpMajor   = snap?.php_version?.split('.').slice(0, 2).join('.') ?? null
  const sslSev     = sslSeverity(snap?.ssl_days_remaining ?? null)
  const phpSev     = phpSeverity(phpMajor)
  const grade      = vitalsGrade(snap?.performance_score ?? null)
  const gradeColor = vitalsColor(snap?.performance_score ?? null)

  const statusColors: Record<string, string> = {
    online: 'bg-accent', offline: 'bg-danger', pending: 'bg-warn', maintenance: 'bg-muted',
  }
  const statusLabels: Record<string, string> = {
    online: 'Online', offline: 'Offline', pending: 'In afwachting', maintenance: 'Onderhoud',
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Back */}
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text mb-5 transition-colors">
        <ArrowLeft size={14} />
        Terug naar dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="status-dot">
              <span className={cn('w-2 h-2 rounded-full', statusColors[site.status ?? 'pending'])} />
              <span className="text-sm text-muted">{statusLabels[site.status ?? 'pending']}</span>
            </span>
          </div>
          <h1 className="text-2xl font-extrabold text-text tracking-tight">{site.name}</h1>
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
        <div className="text-right">
          <p className="text-xs text-muted">Laatste heartbeat</p>
          <p className="text-sm font-semibold text-text">{timeAgo(site.last_heartbeat_at)}</p>
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
        <InfoTile label="WordPress" value={snap?.wp_version ?? '—'} mono />
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
            {(plugins ?? []).filter(p => p.update_available).length > 0 && (
              <span className="badge badge-warn">
                {(plugins ?? []).filter(p => p.update_available).length} update{(plugins ?? []).filter(p => p.update_available).length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="divide-y divide-border max-h-72 overflow-y-auto">
            {(plugins ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Geen plugin-data beschikbaar.</p>
            ) : (
              (plugins as SitePlugin[]).map(plugin => (
                <div key={plugin.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate">{plugin.name}</p>
                    <p className="text-xs text-subtle mono">{plugin.version}</p>
                  </div>
                  {plugin.update_available && plugin.update_version && (
                    <span className="badge badge-warn flex-shrink-0">→ {plugin.update_version}</span>
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
              (runs as UpdateRun[]).map(run => (
                <div key={run.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate">{run.slug}</p>
                    <p className="text-xs text-subtle">{run.from_version} → {run.to_version}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <RunStatusBadge status={run.status} />
                    <p className="text-[10px] text-subtle mt-0.5">{timeAgo(run.created_at)}</p>
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
              <VitalTile label="CLS" value={snap.cls_score != null ? snap.cls_score.toFixed(3) : '—'} ok={snap.cls_score != null && snap.cls_score < 0.1} />
              <VitalTile label="FID" value={snap.fid_ms != null ? `${snap.fid_ms}ms` : '—'} ok={snap.fid_ms != null && snap.fid_ms < 100} />
              <VitalTile label="TTFB" value={snap.ttfb_ms != null ? `${snap.ttfb_ms}ms` : '—'} ok={snap.ttfb_ms != null && snap.ttfb_ms < 800} />
            </div>
          </section>
        )}

        {/* Recent alerts */}
        <section className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <AlertTriangle size={15} className="text-accent" />
            <h2 className="font-bold text-text">Recente meldingen</h2>
          </div>
          <div className="divide-y divide-border">
            {(alerts ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Geen meldingen.</p>
            ) : (
              (alerts as Alert[]).map(alert => (
                <div key={alert.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-text">{alert.message}</p>
                    <span className={cn('badge flex-shrink-0', {
                      'badge-danger': alert.severity === 'critical',
                      'badge-warn':   alert.severity === 'warning',
                      'badge-muted':  alert.severity === 'info',
                    })}>
                      {alert.severity}
                    </span>
                  </div>
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
  const cls: Record<string, string> = {
    completed: 'badge-ok',
    failed:    'badge-danger',
    blocked:   'badge-danger',
    queued:    'badge-muted',
    staging:   'badge-warn',
    testing:   'badge-warn',
    applying:  'badge-warn',
  }
  return <span className={cn('badge', cls[status] ?? 'badge-muted')}>{runStatusLabel(status as any)}</span>
}
