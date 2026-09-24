import Link from 'next/link'
import { AlertList, type AlertRow } from '@/components/AlertList'
import { InboxList } from '@/components/ops/views'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { requireAgency } from '@/lib/session'
import { daysAgoIso, requestNow } from '@/lib/format'
import { loadOperations } from '@/lib/operations/load'
import { cn } from '@/lib/cn'

export async function generateMetadata() {
  return { title: (await getT())('ops.inbox.pageTitle') }
}

/** Inbox: alles waarvoor Verploy een mens nodig heeft; tweede tab = afgehandelde meldingen. */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireAgency()
  const { view } = await searchParams
  const resolved = view === 'resolved'
  const [t, locale, supabase] = await Promise.all([getT(), getLocale(), createClient()])
  const now = requestNow()

  let body: React.ReactNode
  if (resolved) {
    const { data } = await supabase.from('alerts')
      .select('id, type, severity, status, params, opened_at, resolved_at, acknowledged_at, site_id')
      .eq('status', 'resolved').gte('resolved_at', daysAgoIso(30, now)).order('resolved_at', { ascending: false }).limit(200)
    const { data: sites } = await supabase.from('sites').select('id, name')
    const siteById = new Map((sites ?? []).map(s => [s.id, s]))
    const rows: AlertRow[] = (data ?? []).map(a => ({ ...a, site: siteById.get(a.site_id) ?? null }))
    body = rows.length === 0
      ? <p className="px-5 py-10 text-center text-sm text-muted">{t('alerts.emptyResolved')}</p>
      : <AlertList alerts={rows} t={t} locale={locale} />
  } else {
    const ops = await loadOperations(supabase, session.agency, now)
    body = ops.inbox.length === 0
      ? <p className="px-5 py-10 text-center text-sm text-muted">{t('ops.inbox.empty')}</p>
      : <InboxList items={ops.inbox} t={t} locale={locale} now={now} />
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('ops.inbox.pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted">{t('ops.inbox.intro')}</p>
      </div>
      <nav className="flex gap-1 border-b border-border" aria-label={t('ops.inbox.pageTitle')}>
        {[{ href: '/inbox', label: t('ops.inbox.openTab'), active: !resolved }, { href: '/inbox?view=resolved', label: t('ops.inbox.resolvedTab'), active: resolved }].map(tab => (
          <Link key={tab.href} href={tab.href} aria-current={tab.active ? 'page' : undefined}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-semibold', tab.active ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text')}>
            {tab.label}
          </Link>
        ))}
      </nav>
      <section className="rounded-(--radius-card) border border-border bg-surface">{body}</section>
    </div>
  )
}
