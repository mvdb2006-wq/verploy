import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { agencyIsWritable, canManage, requireAgency } from '@/lib/session'
import { effectiveStatus, formatDate, formatRelative } from '@/lib/format'
import type { MessageKey } from '@/lib/i18n/core'
import { AlertList } from '@/components/AlertList'
import { SEVERITY_ORDER } from '@/lib/monitoring/present'
import { PairingPanel } from './pairing'
import { DeleteSite } from './delete'
import { UpdatesPanel } from './updates'
import { TestSettings } from './test-settings'
import { RunHistory } from './run-history'
import { ClientReports } from './client-reports'
import { MIN_CONNECTOR_FOR_RUNS, runBadge, versionAtLeast } from '@/lib/runs'
import { SecurityPanel, type Attribution, type SecurityFinding } from './security'

function memoryRaw(raw: unknown): string | null {
  const server = (raw as { server?: { memory_limit?: unknown } } | null)?.server
  return typeof server?.memory_limit === 'string' ? server.memory_limit : null
}

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const session = await requireAgency()
  const [t, locale, supabase] = await Promise.all([getT(), getLocale(), createClient()])
  const { data: site } = await supabase.from('sites').select('*').eq('id', id).maybeSingle()
  if (!site) notFound()
  const [{ data: snap }, { data: components }, { data: alerts }, { data: runs }, { data: vulns }, { data: feed }] = await Promise.all([
    supabase.from('health_snapshots').select('memory_limit_mb, disk_free_mb, captured_at, raw').eq('site_id', id).order('id', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('site_components').select('type, slug, name, version, latest_version, update_available, active').eq('site_id', id)
      .order('update_available', { ascending: false }).order('active', { ascending: false }).order('type').order('name'),
    supabase.from('alerts').select('id, type, severity, status, params, opened_at, resolved_at, acknowledged_at')
      .eq('site_id', id).eq('status', 'open').neq('severity', 'info').order('opened_at', { ascending: false }),
    supabase.from('update_runs').select('id, status, verdict, items, created_at, finished_at, reason_key, reason_params')
      .eq('site_id', id).order('created_at', { ascending: false }).limit(10),
    supabase.from('site_vulnerabilities').select('vulnerability_id, component_type, component_slug, component_name, installed_version, fixed_version, fixable, severity, autofix_run_id')
      .eq('site_id', id).eq('status', 'open'),
    supabase.from('vulnerability_feed_state').select('fetched_at, attribution').eq('id', 1).maybeSingle(),
  ])
  const vulnIds = [...new Set((vulns ?? []).map(v => v.vulnerability_id))]
  const autofixRunIds = [...new Set((vulns ?? []).map(v => v.autofix_run_id).filter((x): x is string => Boolean(x)))]
  const [{ data: vulnDetails }, { data: autofixRuns }] = await Promise.all([
    vulnIds.length ? supabase.from('vulnerabilities').select('id, title, cve, cvss_score, reference_url, mitre').in('id', vulnIds) : Promise.resolve({ data: [] }),
    autofixRunIds.length ? supabase.from('update_runs').select('id, status, verdict').in('id', autofixRunIds) : Promise.resolve({ data: [] }),
  ])
  const detailById = new Map((vulnDetails ?? []).map(d => [d.id, d]))
  const runById = new Map((autofixRuns ?? []).map(r => [r.id, r]))
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const
  const findings: SecurityFinding[] = (vulns ?? []).map(v => {
    const d = detailById.get(v.vulnerability_id)
    const r = v.autofix_run_id ? runById.get(v.autofix_run_id) : undefined
    return {
      vulnerabilityId: v.vulnerability_id, type: v.component_type, slug: v.component_slug, name: v.component_name,
      installed: v.installed_version, fixed: v.fixed_version, fixable: v.fixable,
      severity: v.severity as SecurityFinding['severity'], title: d?.title ?? v.vulnerability_id,
      cve: d?.cve ?? null, cvss: d?.cvss_score ?? null, url: d?.reference_url ?? null, mitre: d?.mitre ?? false,
      autofixRun: r ? { id: r.id, ...runBadge(t, r) } : null,
    }
  }).sort((a, b) => rank[a.severity] - rank[b.severity] || a.name.localeCompare(b.name))
  const openAlerts = (alerts ?? []).sort((a, b) => (SEVERITY_ORDER[a.severity as keyof typeof SEVERITY_ORDER] ?? 9) - (SEVERITY_ORDER[b.severity as keyof typeof SEVERITY_ORDER] ?? 9))
  const phpAlert = openAlerts.find(a => a.type === 'php_eol')
  const phpEol = (phpAlert?.params as { eol?: string } | undefined)?.eol
  const health: Array<{ label: string; value: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = [
    {
      label: t('health.ssl'),
      ...(site.url.startsWith('http://') ? { value: t('health.noHttps'), tone: 'warn' as const }
        : !site.ssl_checked_at ? { value: t('health.sslPending'), tone: 'muted' as const }
        : site.ssl_valid === false && site.ssl_error ? { value: t(`alerts.sslError.${site.ssl_error}` as MessageKey), tone: 'danger' as const }
        : { value: site.ssl_expires_at ? t('health.sslUntil', { date: formatDate(site.ssl_expires_at, locale) }) : '—', tone: openAlerts.some(a => a.type === 'ssl_expiring') ? 'warn' as const : 'ok' as const }),
    },
    {
      label: t('health.domain'),
      ...(site.domain_expires_at ? { value: t('health.domainUntil', { date: formatDate(site.domain_expires_at, locale) }), tone: openAlerts.some(a => a.type === 'domain_expiring') ? 'warn' as const : 'ok' as const }
        : site.domain_error === 'not_published' ? { value: t('health.domainNotPublished'), tone: 'muted' as const }
        : site.domain_error === 'lookup_failed' ? { value: t('health.domainFailed'), tone: 'muted' as const }
        : { value: t('health.sslPending'), tone: 'muted' as const }),
    },
    {
      label: t('health.php'),
      ...(phpAlert && phpEol ? { value: phpAlert.severity === 'critical' ? t('alerts.types.php_eol_past.title', { version: site.php_version?.split('.').slice(0, 2).join('.') ?? '' }) : t('alerts.types.php_eol_soon.title', { version: site.php_version?.split('.').slice(0, 2).join('.') ?? '', date: formatDate(phpEol, locale) }), tone: phpAlert.severity === 'critical' ? 'danger' as const : 'warn' as const }
        : { value: site.php_version ? `${site.php_version} · ${t('health.phpOk')}` : '—', tone: site.php_version ? 'ok' as const : 'muted' as const }),
    },
    {
      label: t('health.disk'),
      value: snap?.disk_free_mb != null ? `${(snap.disk_free_mb / 1024).toFixed(1)} GB` : '—',
      tone: openAlerts.some(a => a.type === 'disk_low') ? 'warn' : snap?.disk_free_mb != null ? 'ok' : 'muted',
    },
  ]
  const status = effectiveStatus(site)
  const connected = site.connection_status === 'connected'
  const manage = canManage(session.role)
  const activeRun = (runs ?? []).find(r => r.status !== 'done') ?? null
  const blockedReason = !connected ? null
    : !versionAtLeast(site.connector_version, MIN_CONNECTOR_FOR_RUNS) ? t('runs.panel.connectorOutdated', { version: site.connector_version ?? '—' })
    : !agencyIsWritable(session.agency) ? t('runs.errorReadOnly')
    : null

  const facts: Array<[string, string]> = [
    [t('siteDetail.wordpress'), site.wp_version ?? '—'],
    [t('siteDetail.php'), site.php_version ?? '—'],
    [t('siteDetail.connector'), site.connector_version ?? '—'],
    [t('siteDetail.memoryLimit'), snap?.memory_limit_mb ? `${snap.memory_limit_mb} MB` : memoryRaw(snap?.raw) === '-1' ? t('siteDetail.unlimited') : '—'],
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted hover:text-text">← {t('siteDetail.back')}</Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold tracking-tight">{site.name}</h1>
            <a href={site.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1.5 font-mono text-sm text-muted hover:text-accent">
              {site.url.replace(/^https?:\/\//, '')} <ExternalLink size={12} aria-hidden />
            </a>
            {site.client_name && <p className="mt-1 text-sm text-subtle">{t('siteDetail.client')}: {site.client_name}</p>}
          </div>
          <div className="text-right">
            <StatusBadge status={status} label={t(`site.status.${status}` as MessageKey)} />
            <p className="mt-1 text-xs text-muted">
              {t('siteDetail.lastHeartbeat')}: {formatRelative(site.last_heartbeat_at, locale) ?? t('common.never')}
            </p>
            {connected && site.paired_at && (
              <p className="text-xs text-subtle">{t('siteDetail.connectedSince', { date: formatDate(site.paired_at, locale) })}</p>
            )}
          </div>
        </div>
      </div>

      {!connected && manage && <PairingPanel siteId={site.id} connected={false} />}

      {connected && openAlerts.length > 0 && (
        <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="alerts-title">
          <h2 id="alerts-title" className="border-b border-border px-5 py-4 font-bold">{t('health.openAlerts')}</h2>
          <AlertList alerts={openAlerts} t={t} locale={locale} showSite={false} />
        </section>
      )}

      {connected && (
        <section aria-labelledby="health-title">
          <h2 id="health-title" className="sr-only">{t('health.title')}</h2>
          <dl className="grid gap-px overflow-hidden rounded-(--radius-card) border border-border bg-border sm:grid-cols-2">
            {health.map(h => (
              <div key={h.label} className="flex items-start gap-3 bg-surface px-5 py-4">
                <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${{ ok: 'bg-accent', warn: 'bg-warn', danger: 'bg-danger', muted: 'bg-subtle' }[h.tone]}`} />
                <div className="min-w-0">
                  <dt className="text-xs font-semibold text-muted">{h.label}</dt>
                  <dd className="mt-0.5 text-sm">{h.value}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>
      )}

      {connected && (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-(--radius-card) border border-border bg-border md:grid-cols-4">
          {facts.map(([label, value]) => (
            <div key={label} className="bg-surface px-5 py-4">
              <dt className="text-xs font-semibold text-muted">{label}</dt>
              <dd className="mt-1.5 font-mono text-lg font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {connected && (feed?.fetched_at || findings.length > 0) && (
        <SecurityPanel
          siteId={site.id}
          findings={findings}
          checkedAt={site.vulns_checked_at ? formatDate(site.vulns_checked_at, locale, true) : null}
          runnable={!blockedReason}
          activeRunId={activeRun?.id ?? null}
          autofix={Boolean(session.agency.security_autofix)}
          attribution={(feed?.attribution ?? {}) as { defiant?: Attribution; mitre?: Attribution }}
        />
      )}

      <UpdatesPanel siteId={site.id} components={components ?? []} canRun={connected} activeRunId={activeRun?.id ?? null} blockedReason={blockedReason} />

      {(runs ?? []).length > 0 && <RunHistory siteId={site.id} runs={runs ?? []} t={t} locale={locale} />}

      <ClientReports siteId={site.id} clientName={site.client_name} clientEmail={site.client_email} reportLocale={site.report_locale}
        monthly={site.report_monthly} canEdit={manage} />

      {connected && manage && (
        <TestSettings siteId={site.id} paths={site.test_paths} masks={site.test_masks} threshold={Number(site.diff_threshold)} />
      )}

      {connected && manage && <PairingPanel siteId={site.id} connected />}
      {manage && <DeleteSite siteId={site.id} name={site.name} />}
    </div>
  )
}
