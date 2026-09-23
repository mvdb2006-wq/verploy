import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Globe, Wifi, WifiOff, Clock, Code2,
  Puzzle, Palette, Key, RefreshCw, Plug,
  CheckCircle2, XCircle, Loader2, ArrowUpCircle,
} from 'lucide-react'
import { timeAgo, formatDate, phpSeverity } from '@/lib/utils'
import CopyButton from '../new/success/CopyButton'
import DeleteSiteButton from './DeleteSiteButton'
import EditSiteForm from './EditSiteForm'
import TriggerUpdateButton from './TriggerUpdateButton'
import { revalidatePath } from 'next/cache'

// ─── Server Actions ───────────────────────────────────────────────────────────

async function deleteSite(siteId: string): Promise<{ error?: string }> {
  'use server'
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Niet ingelogd' }

  const { data: membership } = await supabase
    .from('agency_members')
    .select('agency_id')
    .eq('user_id', user.id)
    .single()
  if (!membership) return { error: 'Geen toegang' }

  const { error } = await supabase
    .from('sites')
    .delete()
    .eq('id', siteId)
    .eq('agency_id', membership.agency_id)

  if (error) return { error: error.message }
  revalidatePath('/settings')
  revalidatePath('/dashboard')
  redirect('/settings')
}

async function updateSite(formData: FormData): Promise<{ error?: string }> {
  'use server'
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Niet ingelogd' }

  const { data: membership } = await supabase
    .from('agency_members')
    .select('agency_id')
    .eq('user_id', user.id)
    .single()
  if (!membership) return { error: 'Geen toegang' }

  const id          = formData.get('id') as string
  const name        = (formData.get('name') as string)?.trim()
  const url         = (formData.get('url') as string)?.trim()
  const client_name = (formData.get('client_name') as string)?.trim() || null

  if (!name || !url) return { error: 'Naam en URL zijn verplicht' }

  const { error } = await supabase
    .from('sites')
    .update({ name, url, client_name, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('agency_id', membership.agency_id)

  if (error) return { error: error.message }
  revalidatePath(`/settings/sites/${id}`)
  revalidatePath('/settings')
  return {}
}

async function createUpdateJob(formData: FormData): Promise<{ error?: string }> {
  'use server'
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Niet ingelogd' }

  const { data: membership } = await supabase
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
  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('id', site_id)
    .eq('agency_id', membership.agency_id)
    .single()

  if (!site) return { error: 'Site niet gevonden' }

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

  revalidatePath(`/settings/sites/${site_id}`)
  return {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function generateMetadata() {
  return { title: 'Site details' }
}

type WpData = {
  wp_version?: string | null
  php_version?: string | null
  site_url?: string | null
  theme?: string | null
  plugins?: string[]
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    online:  'badge-accent',
    offline: 'badge-danger',
    unknown: 'badge-muted',
    pending: 'badge-warn',
  }
  return (
    <span className={`badge ${map[status] ?? 'badge-muted'} capitalize`}>
      {status === 'online'
        ? <Wifi size={11} className="inline mr-1" />
        : <WifiOff size={11} className="inline mr-1" />}
      {status}
    </span>
  )
}

function JobStatusIcon({ status }: { status: string }) {
  if (status === 'success')   return <CheckCircle2 size={14} className="text-accent shrink-0" />
  if (status === 'failed')    return <XCircle size={14} className="text-danger shrink-0" />
  if (status === 'running')   return <Loader2 size={14} className="text-warn animate-spin shrink-0" />
  return <Clock size={14} className="text-muted shrink-0" />
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

  const { data: site } = await supabase
    .from('sites')
    .select('id, name, url, client_name, status, api_key, created_at, last_ping_at, wp_data, connector_version, wp_version, php_version')
    .eq('id', params.id)
    .eq('agency_id', membership.agency_id)
    .single()

  if (!site) notFound()

  // Fetch structured plugin data from site_plugins table
  const { data: plugins } = await supabase
    .from('site_plugins')
    .select('slug, name, version, latest_version, update_available, active')
    .eq('site_id', site.id)
    .order('update_available', { ascending: false })
    .order('name', { ascending: true })

  // Fetch recent update jobs (last 20)
  const { data: jobs } = await supabase
    .from('update_jobs')
    .select('id, type, slug, name, from_version, to_version, status, result_log, created_at, completed_at')
    .eq('site_id', site.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const wp     = (site.wp_data ?? {}) as WpData
  const phpBad = phpSeverity(site.php_version ?? wp.php_version ?? null)
  const updatesAvailable = plugins?.filter(p => p.update_available).length ?? 0

  const deleteSiteBound = deleteSite.bind(null, site.id)

  return (
    <div className="p-6 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/settings" className="text-muted hover:text-text transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="section-label mb-0.5">Instellingen → Sites</p>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold text-text tracking-tight truncate">{site.name}</h1>
            <EditSiteForm
              siteId={site.id}
              initialName={site.name}
              initialUrl={site.url}
              initialClientName={site.client_name ?? null}
              updateAction={updateSite}
            />
          </div>
        </div>
        <StatusBadge status={site.status} />
        <a href={`/settings/sites/${site.id}`} className="text-muted hover:text-text transition-colors" title="Verversen">
          <RefreshCw size={16} />
        </a>
      </div>

      {/* Sitegegevens */}
      <div className="card mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Globe size={15} className="text-accent" />
          <h2 className="font-bold text-text">Sitegegevens</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="label">URL</p>
            <a href={site.url} target="_blank" rel="noopener" className="text-accent hover:underline font-mono text-xs break-all">
              {site.url}
            </a>
          </div>
          {site.client_name && (
            <div>
              <p className="label">Klant</p>
              <p className="text-text font-semibold">{site.client_name}</p>
            </div>
          )}
          <div>
            <p className="label">Toegevoegd</p>
            <p className="text-text">{formatDate(site.created_at)}</p>
          </div>
          <div>
            <p className="label">Laatste ping</p>
            <p className="text-text flex items-center gap-1">
              <Clock size={12} className="text-muted" />
              {site.last_ping_at ? timeAgo(site.last_ping_at) : <span className="text-muted">Nog niet gepingd</span>}
            </p>
          </div>
          {site.connector_version && (
            <div>
              <p className="label flex items-center gap-1"><Plug size={11} /> Verploy Connector</p>
              <p className="text-text font-mono text-xs">v{site.connector_version}</p>
            </div>
          )}
        </div>
      </div>

      {/* API-sleutel */}
      <div className="card mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Key size={15} className="text-accent" />
          <h2 className="font-bold text-text">API-sleutel</h2>
        </div>
        <div className="bg-surface2 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
          <code className="text-xs font-mono text-muted break-all">{site.api_key}</code>
          <CopyButton value={site.api_key} />
        </div>
      </div>

      {/* WordPress omgeving */}
      {(site.wp_version || site.php_version) && (
        <div className="card mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Code2 size={15} className="text-accent" />
            <h2 className="font-bold text-text">WordPress omgeving</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="label">WordPress</p>
              <p className="text-text font-semibold">{site.wp_version ?? '—'}</p>
            </div>
            <div>
              <p className="label">PHP</p>
              <p className={`font-semibold ${
                phpBad === 'danger' ? 'text-danger' :
                phpBad === 'warn'   ? 'text-warn'   : 'text-text'
              }`}>
                {site.php_version ?? '—'}
                {phpBad === 'danger' && <span className="ml-1 text-xs font-normal">(verouderd!)</span>}
                {phpBad === 'warn'   && <span className="ml-1 text-xs font-normal">(update aanbevolen)</span>}
              </p>
            </div>
            {wp.theme && (
              <div className="col-span-2">
                <p className="label flex items-center gap-1"><Palette size={11} /> Thema</p>
                <p className="text-text">{wp.theme}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Plugins */}
      {plugins && plugins.length > 0 ? (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Puzzle size={15} className="text-accent" />
              <h2 className="font-bold text-text">Plugins ({plugins.length})</h2>
            </div>
            {updatesAvailable > 0 && (
              <span className="badge badge-warn text-xs">
                <ArrowUpCircle size={11} className="inline mr-1" />
                {updatesAvailable} update{updatesAvailable > 1 ? 's' : ''} beschikbaar
              </span>
            )}
          </div>
          <div className="divide-y divide-surface2">
            {plugins.map((plugin) => (
              <div key={plugin.slug} className="flex items-center justify-between py-2 gap-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${plugin.active ? 'text-text' : 'text-muted'}`}>
                    {plugin.name}
                    {!plugin.active && <span className="ml-1 text-xs font-normal">(inactief)</span>}
                  </p>
                  <p className="text-xs text-muted font-mono">{plugin.version}</p>
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
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card mb-4 bg-surface2/50">
          <p className="text-sm text-muted text-center py-2">
            Plugin-data beschikbaar zodra de connector zijn eerste ping stuurt.
          </p>
        </div>
      )}

      {/* Update history */}
      {jobs && jobs.length > 0 && (
        <div className="card mb-4">
          <div className="flex items-center gap-2 mb-3">
            <ArrowUpCircle size={15} className="text-accent" />
            <h2 className="font-bold text-text">Update history</h2>
          </div>
          <div className="divide-y divide-surface2">
            {jobs.map((job) => (
              <div key={job.id} className="py-2">
                <div className="flex items-center gap-2">
                  <JobStatusIcon status={job.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text font-medium truncate">
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
                          : `In wachtrij • ${timeAgo(job.created_at)}`}
                    </p>
                  </div>
                </div>
                {job.result_log && (
                  <pre className="mt-1 ml-6 text-xs text-muted bg-surface2 rounded p-2 overflow-x-auto max-h-24 whitespace-pre-wrap">
                    {job.result_log}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Acties */}
      <div className="flex gap-3 mb-4">
        <Link href="/settings" className="btn btn-ghost flex-1 justify-center">
          Terug
        </Link>
        <a href={site.url} target="_blank" rel="noopener" className="btn btn-primary flex-1 justify-center">
          Site openen
          <Globe size={14} />
        </a>
      </div>

      {/* Danger zone */}
      <div className="card border border-danger/20 bg-danger/5">
        <p className="text-xs font-bold text-danger uppercase tracking-widest mb-3">Gevaarlijke zone</p>
        <DeleteSiteButton siteId={site.id} siteName={site.name} onDelete={deleteSiteBound} />
      </div>

    </div>
  )
}
