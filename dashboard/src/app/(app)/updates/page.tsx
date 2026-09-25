import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { agencyIsWritable, requireAgency } from '@/lib/session'
import { groupUpdates } from '@/lib/updates/group'
import type { MessageKey } from '@/lib/i18n/core'
import { IntelBadge } from '@/components/IntelBadge'
import { intelKey, intelMap } from '@/lib/updates/intel'
import { UpdateEverywhere } from './update-everywhere'

export async function generateMetadata() {
  return { title: (await getT())('bulk.title') }
}

/** Alle beschikbare updates, per onderdeel over al je sites, met één knop per onderdeel. */
export default async function UpdatesPage() {
  const session = await requireAgency()
  const [t, supabase] = await Promise.all([getT(), createClient()])
  const [{ data: comps }, { data: sites }, { data: active }, { data: vulns }] = await Promise.all([
    supabase.from('site_components').select('site_id, type, slug, name, version, latest_version').eq('update_available', true),
    supabase.from('sites').select('id, name, connection_status'),
    supabase.from('update_runs').select('site_id').neq('status', 'done'),
    supabase.from('site_vulnerabilities').select('site_id, component_type, component_slug').eq('status', 'open').eq('fixable', true),
  ])
  const connected = new Set((sites ?? []).filter(s => s.connection_status === 'connected').map(s => s.id))
  const groups = groupUpdates((comps ?? []).filter(c => connected.has(c.site_id)), new Map((sites ?? []).map(s => [s.id, s.name])), {
    busySites: new Set((active ?? []).map(r => r.site_id)),
    vulnerable: new Set((vulns ?? []).map(v => `${v.site_id}:${v.component_type}:${v.component_slug}`)),
  })
  const slugs = [...new Set(groups.map(g => g.slug))]
  const { data: intelRows } = slugs.length
    ? await supabase.from('update_intel').select('type, slug, version, ok_sites, failed_sites').in('slug', slugs)
    : { data: [] }
  const intel = intelMap(intelRows ?? [])
  const writable = agencyIsWritable(session.agency)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('bulk.title')}</h1>
        <p className="mt-1 text-sm text-muted">{groups.length ? t('bulk.intro') : t('bulk.none')}</p>
        {session.agency.auto_updates && groups.length > 0 && <p className="mt-1 text-sm text-muted">{t('bulk.autoOn')}</p>}
      </header>
      {groups.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-(--radius-card) border border-border bg-surface">
          {groups.map(g => (
            <li key={g.key} className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {g.name} <span className="font-mono text-sm text-muted">→ {g.target}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {t(`siteDetail.type.${g.type}` as MessageKey)} · {t('bulk.sites', { count: g.sites.length })}
                    {g.security && <span className="badge badge-danger ml-2">{t('bulk.security')}</span>}
                    {g.major && <span className="badge badge-warn ml-2">{t('bulk.major')}</span>}
                  </p>
                  <p className="mt-1.5"><IntelBadge intel={intel.get(intelKey(g.type, g.slug, g.target))} /></p>
                </div>
                <UpdateEverywhere type={g.type} slug={g.slug} count={g.sites.length} disabled={!writable} />
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-muted hover:text-text">{t('bulk.showSites')}</summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {g.sites.map(s => (
                    <li key={s.siteId} className="flex flex-wrap items-center gap-2">
                      <Link href={`/sites/${s.siteId}#updates`} className="font-medium hover:text-accent">{s.siteName}</Link>
                      <span className="font-mono text-xs text-subtle">{s.from ?? '—'} → {s.to}</span>
                      {s.busy && <span className="badge badge-muted">{t('bulk.busy')}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
