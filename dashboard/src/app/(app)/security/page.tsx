import Link from 'next/link'
import { VulnGroupCard } from '@/components/ops/views'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { requireAgency } from '@/lib/session'
import { formatRelative, requestNow } from '@/lib/format'
import { formatDuration } from '@/lib/operations/model'
import { loadOperations } from '@/lib/operations/load'

export async function generateMetadata() {
  return { title: (await getT())('ops.security.title') }
}

interface Attribution { notice: string; license: string }

/** Beveiliging: bekende lekken over alle sites, per kwetsbaarheid, met blootstellingstijd. */
export default async function SecurityPage() {
  const session = await requireAgency()
  const [t, locale, supabase] = await Promise.all([getT(), getLocale(), createClient()])
  const now = requestNow()
  const ops = await loadOperations(supabase, session.agency, now)
  const { data: feed } = await supabase.from('vulnerability_feed_state').select('attribution').eq('id', 1).maybeSingle()
  const attribution = (feed?.attribution ?? {}) as { defiant?: Attribution; mitre?: Attribution }
  const kpis = [
    { label: t('ops.security.kpiOpen'), value: String(ops.exposure.openSerious) },
    { label: t('ops.security.kpiSites'), value: `${ops.exposure.exposedSites} / ${ops.sites.length}` },
    { label: t('ops.security.kpiMedian'), value: ops.exposure.medianResolvedMs === null ? '—' : formatDuration(ops.exposure.medianResolvedMs, t) },
    { label: t('ops.security.kpiMode'), value: ops.autofix ? t('ops.security.modeAuto') : t('ops.security.modeApprove') },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('ops.security.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('ops.security.intro')}</p>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-(--radius-card) border border-border bg-border md:grid-cols-4">
        {kpis.map(k => (
          <div key={k.label} className="bg-surface px-5 py-4">
            <dt className="text-xs font-semibold text-muted">{k.label}</dt>
            <dd className="mt-1.5 font-mono text-lg font-bold tabular-nums">{k.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted">
        {ops.autofix ? t('security.autofixOn') : t('security.autofixOff')}{' '}
        <Link href="/settings#security" className="font-semibold text-accent hover:underline">{t('security.changeSetting')}</Link>
      </p>
      <section className="rounded-(--radius-card) border border-border bg-surface" aria-label={t('ops.security.title')}>
        {!ops.feedFetchedAt && ops.groups.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">{t('ops.security.notActive')}</p>
          : ops.groups.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">{t('ops.security.empty')}</p>
          : <div className="divide-y divide-border/60">{ops.groups.map(g => <VulnGroupCard key={g.id} g={g} t={t} now={now} />)}</div>}
        <footer className="border-t border-border px-5 py-3 text-xs text-subtle">
          {ops.feedFetchedAt && <span>{t('ops.system', { time: formatRelative(ops.feedFetchedAt, locale, now) ?? '' })} · </span>}
          {t('security.source')}
          {(attribution.defiant || attribution.mitre) && (
            <details className="mt-1">
              <summary className="cursor-pointer hover:text-muted">{t('security.licence')}</summary>
              <div className="mt-2 space-y-2">
                {attribution.defiant && <p>{attribution.defiant.notice}. {attribution.defiant.license}</p>}
                {attribution.mitre && <p>{attribution.mitre.notice}. {attribution.mitre.license}</p>}
              </div>
            </details>
          )}
        </footer>
      </section>
    </div>
  )
}
