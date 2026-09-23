import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { canManage, requireAgency } from '@/lib/session'
import { effectiveStatus, formatDate, formatRelative } from '@/lib/format'
import type { MessageKey } from '@/lib/i18n/core'
import { AlertList } from '@/components/AlertList'
import { SEVERITY_ORDER } from '@/lib/monitoring/present'
import { PairingPanel } from './pairing'
import { DeleteSite } from './delete'

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
  const [{ data: snap }, { data: components }, { data: alerts }] = await Promise.all([
    supabase.from('health_snapshots').select('memory_limit_mb, disk_free_mb, captured_at, raw').eq('site_id', id).order('id', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('site_components').select('type, slug, name, version, latest_version, update_available, active').eq('site_id', id)
      .order('update_available', { ascending: false }).order('active', { ascending: false }).order('type').order('name'),
    supabase.from('alerts').select('id, type, severity, status, params, opened_at, resolved_at, acknowledged_at')
      .eq('site_id', id).eq('status', 'open').neq('severity', 'info').order('opened_at', { ascending: false }),
  ])
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
  const updates = (components ?? []).filter(c => c.update_available).length

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

      <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="components-title">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
          <h2 id="components-title" className="font-bold">{t('siteDetail.componentsTitle')}</h2>
          {updates > 0 && <span className="badge badge-warn">{t('siteDetail.updatesAvailable', { count: updates })}</span>}
        </header>
        {(components ?? []).length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">{t('siteDetail.componentsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {(components ?? []).map(c => (
              <li key={`${c.type}:${c.slug}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {c.name}
                    {!c.active && <span className="ml-2 text-xs text-subtle">({t('siteDetail.inactive')})</span>}
                  </p>
                  <p className="font-mono text-xs text-subtle">{t(`siteDetail.type.${c.type}` as MessageKey)} · {c.version ?? '—'}</p>
                </div>
                {c.update_available && c.latest_version
                  ? <span className="badge badge-warn">{t('siteDetail.updateTo', { version: c.latest_version })}</span>
                  : <span className="text-xs text-muted">{t('siteDetail.upToDate')}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {connected && manage && <PairingPanel siteId={site.id} connected />}
      {manage && <DeleteSite siteId={site.id} name={site.name} />}
    </div>
  )
}
