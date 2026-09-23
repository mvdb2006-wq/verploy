import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { canManage, requireAgency } from '@/lib/session'
import { effectiveStatus, formatDate, formatRelative } from '@/lib/format'
import type { MessageKey } from '@/lib/i18n/core'
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
  const [{ data: snap }, { data: components }] = await Promise.all([
    supabase.from('health_snapshots').select('memory_limit_mb, captured_at, raw').eq('site_id', id).order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('site_components').select('type, slug, name, version, latest_version, update_available, active').eq('site_id', id)
      .order('update_available', { ascending: false }).order('active', { ascending: false }).order('type').order('name'),
  ])
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
