import Link from 'next/link'
import { AlertList, type AlertRow } from '@/components/AlertList'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { requireAgency } from '@/lib/session'
import { SEVERITY_ORDER } from '@/lib/monitoring/present'
import { cn } from '@/lib/cn'
import { daysAgoIso } from '@/lib/format'

export async function generateMetadata() {
  return { title: (await getT())('alerts.title') }
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireAgency()
  const { view } = await searchParams
  const resolved = view === 'resolved'
  const [t, locale, supabase] = await Promise.all([getT(), getLocale(), createClient()])
  const query = supabase.from('alerts')
    .select('id, type, severity, status, params, opened_at, resolved_at, acknowledged_at, site_id')
    .eq('status', resolved ? 'resolved' : 'open')
  const { data } = resolved
    ? await query.gte('resolved_at', daysAgoIso(30)).order('resolved_at', { ascending: false }).limit(200)
    : await query.order('opened_at', { ascending: false }).limit(500)
  const { data: sites } = await supabase.from('sites').select('id, name')
  const siteById = new Map((sites ?? []).map(s => [s.id, s]))
  const rows: AlertRow[] = (data ?? [])
    .map(a => ({ ...a, site: siteById.get(a.site_id) ?? null }))
    .sort((a, b) => resolved ? 0 : (SEVERITY_ORDER[a.severity as keyof typeof SEVERITY_ORDER] ?? 9) - (SEVERITY_ORDER[b.severity as keyof typeof SEVERITY_ORDER] ?? 9))

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('alerts.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('alerts.intro')}</p>
      </div>
      <nav className="flex gap-1 border-b border-border" aria-label={t('alerts.title')}>
        {[{ href: '/alerts', label: t('alerts.openTab'), active: !resolved }, { href: '/alerts?view=resolved', label: t('alerts.resolvedTab'), active: resolved }].map(tab => (
          <Link key={tab.href} href={tab.href} aria-current={tab.active ? 'page' : undefined}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-semibold', tab.active ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text')}>
            {tab.label}
          </Link>
        ))}
      </nav>
      <section className="rounded-(--radius-card) border border-border bg-surface">
        {rows.length === 0
          ? <p className="px-5 py-10 text-center text-sm text-muted">{resolved ? t('alerts.emptyResolved') : t('alerts.empty')}</p>
          : <AlertList alerts={rows} t={t} locale={locale} />}
      </section>
    </div>
  )
}
