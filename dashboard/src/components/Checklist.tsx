import Link from 'next/link'
import { Check } from 'lucide-react'
import type { Translate } from '@/lib/i18n/core'
import { cn } from '@/lib/cn'

export interface ChecklistStep { key: 'addSite' | 'connect' | 'update' | 'report'; done: boolean; href: string }

/** "Aan de slag": verdwijnt vanzelf als alle stappen gedaan zijn. */
export function Checklist({ steps, t }: { steps: ChecklistStep[]; t: Translate }) {
  const done = steps.filter(s => s.done).length
  if (done === steps.length) return null
  const next = steps.find(s => !s.done)
  return (
    <section className="card mb-6" aria-labelledby="checklist-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="checklist-title" className="text-lg font-bold">{t('checklist.title')}</h2>
        <p className="text-sm text-muted tabular-nums">{t('checklist.progress', { done, total: steps.length })}</p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface2" aria-hidden>
        <div className="h-full rounded-full bg-accent" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.key}>
            <Link href={s.href} className={cn('flex gap-3 rounded-lg border p-3 transition-colors', s === next ? 'border-accent/40 bg-accent/5 hover:bg-accent/10' : 'border-border hover:bg-surface2/60')}>
              <span aria-hidden className={cn('flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold', s.done ? 'bg-accent text-bg' : 'bg-surface2 text-muted')}>
                {s.done ? <Check size={14} /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-sm font-semibold', s.done && 'text-muted line-through')}>{t(`checklist.${s.key}`)}</span>
                {!s.done && <span className="block text-xs text-muted">{t(`checklist.${s.key}Body`)}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
