import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Globe, Wifi, WifiOff, Clock, Code2,
  Puzzle, Palette, Key, Copy,
} from 'lucide-react'
import { timeAgo, formatDate, phpSeverity } from '@/lib/utils'
import CopyButton from '../new/success/CopyButton'
import DeleteSiteButton from './DeleteSiteButton'
import { revalidatePath } from 'next/cache'

async function deleteSite(siteId: string): Promise<{ error?: string }> {
  'use server'
  const { createClient } = await import('@/lib/supabase/server')
  const { redirect } = await import('next/navigation')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Niet ingelogd' }

  // Verify ownership
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

export async function generateMetadata({ params }: { params: { id: string } }) {
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
      {status === 'online' ? <Wifi size={11} className="inline mr-1" /> : <WifiOff size={11} className="inline mr-1" />}
      {status}
    </span>
  )
}

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
    .select('id, name, url, client_name, status, api_key, created_at, last_ping_at, wp_data')
    .eq('id', params.id)
    .eq('agency_id', membership.agency_id)
    .single()

  if (!site) notFound()

  const wp = (site.wp_data ?? {}) as WpData
  const phpBad = phpSeverity(wp.php_version ?? null)

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/settings" className="text-muted hover:text-text transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="section-label mb-0.5">Instellingen → Sites</p>
          <h1 className="text-2xl font-extrabold text-text tracking-tight truncate">{site.name}</h1>
        </div>
        <StatusBadge status={site.status} />
      </div>

      {/* Algemeen */}
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

      {/* WordPress-info */}
      {Object.keys(wp).length > 0 ? (
        <div className="card mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Code2 size={15} className="text-accent" />
            <h2 className="font-bold text-text">WordPress omgeving</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm mb-4">
            <div>
              <p className="label">WordPress</p>
              <p className="text-text font-semibold">{wp.wp_version ?? '—'}</p>
            </div>
            <div>
              <p className="label">PHP</p>
              <p className={`font-semibold ${
                phpBad === 'danger' ? 'text-danger' :
                phpBad === 'warn'   ? 'text-warn'   : 'text-text'
              }`}>
                {wp.php_version ?? '—'}
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

          {/* Plugins */}
          {wp.plugins && wp.plugins.length > 0 && (
            <div>
              <p className="label flex items-center gap-1 mb-2">
                <Puzzle size={11} /> Actieve plugins ({wp.plugins.length})
              </p>
              <div className="bg-surface2 rounded-lg px-3 py-2 max-h-48 overflow-y-auto">
                <ul className="space-y-1">
                  {wp.plugins.map((plugin, i) => (
                    <li key={i} className="text-xs text-muted font-mono">{plugin}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="card mb-4 bg-surface2/50">
          <p className="text-sm text-muted text-center py-2">
            WordPress-data beschikbaar zodra de plugin zijn eerste ping stuurt.
          </p>
        </div>
      )}

      {/* Acties */}
      <div className="flex gap-3 mb-4">
        <Link href="/settings" className="btn btn-ghost flex-1 justify-center">
          Terug naar instellingen
        </Link>
        <a href={site.url} target="_blank" rel="noopener" className="btn btn-primary flex-1 justify-center">
          Site openen
          <Globe size={14} />
        </a>
      </div>

      {/* Danger zone */}
      <div className="card border border-danger/20 bg-danger/5">
        <p className="text-xs font-bold text-danger uppercase tracking-widest mb-3">Gevaarlijke zone</p>
        <DeleteSiteButton siteId={site.id} siteName={site.name} onDelete={deleteSite} />
      </div>
    </div>
  )
}
