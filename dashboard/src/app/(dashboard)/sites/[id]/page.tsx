import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { timeAgo, cn, sslSeverity, phpSeverity, vitalsGrade, vitalsColor } from '@/lib/utils'
import TriggerUpdateButton from '@/app/(dashboard)/settings/sites/[id]/TriggerUpdateButton'
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
  Settings,
} from 'lucide-react'

export const metadata = { title: 'Site detail' }

// ─── Server action ────────────────────────────────────────────────────────────

async function createUpdateJob(formData: FormData): Promise<{ error?: string }> {
  'use server'
  // Verify the user is authenticated
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: 'Niet ingelogd' }

  const { data: membership } = await authClient
    .from('agency_members')
    .select('agency_id')
    .eq('user_id', user.id)
    .single()
  if (!membership) return { error: 'Geen toegang' }

  const site_id      = formData.get('site_id') as string
  const slug         = formData.get('slug') as string
  const name         = formData.get('name') as string
  const from_version = formData.get('from_version') as string
  const to_version   = formData.get('to_version') as string

  // Verify site belongs to this agency
  const { data: site } = await authClient
    .from('sites')
    .select('id')
    .eq('id', site_id)
    .eq('agency_id', membership.agency_id)
    .single()
  if (!site) return { error: 'Site niet gevonden' }

  // Use service client to bypass RLS on update_jobs
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('update_jobs')
    .insert({
      site_id,
      agency_id:    membership.agency_id,
      type:         'plugin',
      slug,
      name,
      from_version,
      to_version,
      status:       'pending',
      created_by:   user.id,
    })

  if (error) return { error: error.message }

  revalidatePath(`/sites/${site_id}`)
  return {}
}

// ─── Page ─────────────────────────────────────────────────────────────────────

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
    .select('id, name, url, client_name, status, last_seen_at, last_heartbeat_at, wp_version, php_version, connector_version, created_at')
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
    .select('id, slug, name, version, latest_version, update_available, active, vulnerable')
    .eq('site_id', site.id)
    .eq('active', true)
    .order('update_available', { ascending: false })
    .order('name')
    .limit(50)

  // Recent update jobs (service client bypasses RLS)
  const serviceClient = createServiceClient()
  const { data: jobs } = await serviceClient
    .from('update_jobs')
    .select('id, type, slug, name, from_version, to_version, status, result_log, created_at, completed_at')
    .eq('site_id', site.id)
    .order('created_at', { ascending: false })
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
      {/* Back + Settings */}
      <div className="flex items-center justify-between mb-5">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text transition-colors">
          <ArrowLeft size={14} />
          Terug naar dashboard
        </Link>
        <Link
          href={`/settings/sites/${site.id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text transition-colors"
        >
          <Settings size={14} />
          Instellingen
        </Link>
      </div>

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
        {/* Plugins met update-knoppen */}
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
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {(plugins ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Geen plugin-data beschikbaar.</p>
            ) : (
              (plugins ?? []).map(plugin => (
                <div key={plugin.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text truncate">{plugin.name}</p>
                    <p className="text-xs text-subtle font-mono">{plugin.version}</p>
                  </div>
                  {plugin.update_available && plugin.latest_version ? (
                    <TriggerUpdateButton
                      siteId={site.id}
                      slug={plugin.slug}
                      name={plugin.name}
                      currentVersion={plugin.version ?? ''}
                      toVersion={plugin.latest_version}
                      createJobAction={createUpdateJob}
                    />
                  ) : (
                    <span className="text-xs text-muted shrink-0">✓ up-to-date</span>
                  )}
                  {plugin.vulnerable && (
                    <span className="badge badge-danger flex-shrink-0">kwetsbaar</span>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* Update-geschiedenis */}
        <section className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <RefreshCw size={15} className="text-accent" />
            <h2 className="font-bold text-text">Update-geschiedenis</h2>
          </div>
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {(jobs ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Nog geen updates uitgevoerd.</p>
            ) : (
              (jobs ?? []).map(job => (
                <div key={job.id} className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <JobStatusIcon status={job.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text truncate">
                        {job.name ?? job.slug}
                        {job.from_version && job.to_version && (
                          <span className="text-muted font-normal ml-1 text-xs">
                            {job.from_version} → {job.to_version}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {job.completed_at
                          ? `${job.status === 'success' ? 'Voltooid' : 'Mislukt'} ${timeAgo(job.completed_at)}`
                          : job.status === 'running'
                            ? 'Bezig...'
                            : `In wachtrij · ${timeAgo(job.created_at)}`}
                      </p>
                    </div>
                  </div>
                  {job.result_log && (
                    <pre className="mt-1 ml-6 text-xs text-muted bg-surface2 rounded p-2 overflow-x-auto max-h-20 whitespace-pre-wrap">
                      {job.result_log}
                    </pre>
                  )}
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

        {/* Recente meldingen */}
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

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function JobStatusIcon({ status }: { status: string }) {
  if (status === 'success') return <CheckCircle2 size={14} className="text-accent shrink-0" />
  if (status === 'failed')  return <XCircle size={14} className="text-danger shrink-0" />
  if (status === 'running') return <Loader2 size={14} className="text-warn animate-spin shrink-0" />
  return <Clock size={14} className="text-muted shrink-0" />
}
