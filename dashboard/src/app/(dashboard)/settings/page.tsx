import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { Settings, Key, Globe, Bell, Copy } from 'lucide-react'

export const metadata = { title: 'Instellingen' }

export default async function SettingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('agency_members')
    .select('agency_id, role, agencies(*)')
    .eq('user_id', user.id)
    .single()

  const agency = membership?.agencies as {
    id: string; name: string; slug: string; plan: string; created_at: string
  } | null

  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, url, api_key, status, created_at')
    .eq('agency_id', agency?.id ?? '')
    .order('created_at')

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <p className="section-label mb-1">Beheer</p>
        <h1 className="text-2xl font-extrabold text-text tracking-tight">Instellingen</h1>
      </div>

      {/* Agency info */}
      <div className="card mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Settings size={15} className="text-accent" />
          <h2 className="font-bold text-text">Agency</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="label">Naam</p>
            <p className="text-text font-semibold">{agency?.name ?? '—'}</p>
          </div>
          <div>
            <p className="label">Plan</p>
            <p className="text-text font-semibold capitalize">{agency?.plan ?? 'free'}</p>
          </div>
          <div>
            <p className="label">Slug</p>
            <p className="text-text font-mono text-xs">{agency?.slug ?? '—'}</p>
          </div>
          <div>
            <p className="label">Lid sinds</p>
            <p className="text-text">{formatDate(agency?.created_at ?? null)}</p>
          </div>
        </div>
      </div>

      {/* Account */}
      <div className="card mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Key size={15} className="text-accent" />
          <h2 className="font-bold text-text">Account</h2>
        </div>
        <div className="text-sm">
          <p className="label">E-mailadres</p>
          <p className="text-text font-semibold mb-4">{user.email}</p>
          <p className="label">Rol</p>
          <p className="text-text font-semibold capitalize">{membership?.role ?? '—'}</p>
        </div>
      </div>

      {/* Sites + API keys */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Globe size={15} className="text-accent" />
          <h2 className="font-bold text-text">Sites & API-sleutels</h2>
        </div>

        {(sites ?? []).length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">Geen sites gevonden.</p>
        ) : (
          <div className="divide-y divide-border">
            {(sites ?? []).map(site => (
              <div key={site.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="text-sm font-semibold text-text">{site.name}</p>
                    <p className="text-xs text-subtle">{site.url}</p>
                  </div>
                  <span className="badge badge-muted capitalize text-[10px]">{site.status}</span>
                </div>
                <div className="bg-surface2 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                  <code className="text-xs font-mono text-muted truncate">{site.api_key}</code>
                  <button
                    className="text-subtle hover:text-text flex-shrink-0 transition-colors"
                    title="Kopieer API-sleutel"
                    data-copy={site.api_key}
                  >
                    <Copy size={13} />
                  </button>
                </div>
                <p className="text-[10px] text-subtle mt-1.5">
                  Gebruik deze sleutel in de Verploy connector plugin op deze site.
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
