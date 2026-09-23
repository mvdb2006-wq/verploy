import Link from 'next/link'
import type { Locale, Translate } from '@/lib/i18n/core'
import { formatDate } from '@/lib/format'
import { presentReason, runBadge } from '@/lib/runs'
import { RunBadge } from '@/components/RunBadge'

interface RunRow {
  id: string
  status: string
  verdict: string | null
  items: unknown
  created_at: string
  reason_key: string | null
  reason_params: unknown
}

export function RunHistory({ siteId, runs, t, locale }: { siteId: string; runs: RunRow[]; t: Translate; locale: Locale }) {
  return (
    <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="runs-title">
      <h2 id="runs-title" className="border-b border-border px-5 py-4 font-bold">{t('runs.history.title')}</h2>
      <ul className="divide-y divide-border/60">
        {runs.map(r => {
          const items = (r.items as { name: string; to_version: string | null }[]) ?? []
          const badge = runBadge(t, r)
          return (
            <li key={r.id}>
              <Link href={`/sites/${siteId}/runs/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-surface2/60">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {items.map(i => `${i.name} ${i.to_version ?? ''}`.trim()).join(', ')}
                  </span>
                  <span className="block text-xs text-subtle">
                    {formatDate(r.created_at, locale, true)}
                    {r.status === 'done' && r.verdict !== 'deployed' && r.reason_key ? ` · ${presentReason(t, r.reason_key, r.reason_params)}` : ''}
                  </span>
                </span>
                <RunBadge {...badge} />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
