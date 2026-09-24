'use client'
import { useActionState, useState } from 'react'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import type { MessageKey } from '@/lib/i18n/core'
import { startRun } from './actions'

export interface Component {
  type: string
  slug: string
  name: string
  version: string | null
  latest_version: string | null
  update_available: boolean
  active: boolean
}

/** Componentenlijst; beschikbare updates zijn aan te vinken en veilig uit te voeren. */
export function UpdatesPanel({ siteId, components, canRun, activeRunId, blockedReason }: {
  siteId: string
  components: Component[]
  canRun: boolean
  activeRunId: string | null
  blockedReason: string | null
}) {
  const { t } = useI18n()
  const [state, action] = useActionState(startRun, {})
  const available = components.filter(c => c.update_available && c.latest_version)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(available.map(c => `${c.type}:${c.slug}`)))
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const runnable = canRun && !activeRunId && !blockedReason && available.length > 0

  return (
    <section id="updates" className="scroll-mt-6 rounded-(--radius-card) border border-border bg-surface" aria-labelledby="components-title">
      <form action={action}>
        <input type="hidden" name="site_id" value={siteId} />
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="components-title" className="font-bold">{t('siteDetail.componentsTitle')}</h2>
            {available.length > 0 && <p className="mt-0.5 text-xs text-muted">{t('runs.panel.hint')}</p>}
          </div>
          {available.length > 0 && (
            runnable ? (
              <SubmitButton pendingLabel={t('runs.panel.starting')}>
                <ShieldCheck size={15} aria-hidden /> {t('runs.panel.start', { count: selected.size })}
              </SubmitButton>
            ) : (
              <span className="badge badge-warn">{t('siteDetail.updatesAvailable', { count: available.length })}</span>
            )
          )}
        </header>
        {activeRunId && (
          <p className="border-b border-border bg-accent/5 px-5 py-3 text-sm" role="status">
            {t('runs.panel.active')}{' '}
            <Link href={`/sites/${siteId}/runs/${activeRunId}`} className="font-semibold text-accent hover:underline">{t('runs.panel.view')}</Link>
          </p>
        )}
        {!activeRunId && blockedReason && available.length > 0 && (
          <p className="border-b border-border bg-warn/5 px-5 py-3 text-sm text-warn">{blockedReason}</p>
        )}
        {state.error && <div className="border-b border-border px-5 py-3"><Alert>{state.error}</Alert></div>}
        {components.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">{t('siteDetail.componentsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {components.map(c => {
              const id = `${c.type}:${c.slug}`
              const updatable = c.update_available && c.latest_version
              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <label className={`flex min-w-0 items-start gap-3 ${updatable && runnable ? 'cursor-pointer' : ''}`}>
                    {updatable && runnable && (
                      <input type="checkbox" name="item" value={id} checked={selected.has(id)} onChange={() => toggle(id)}
                        className="mt-1 size-4 shrink-0 accent-(--color-accent)" aria-describedby={`${id}-v`} />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {c.name}
                        {!c.active && <span className="ml-2 text-xs text-subtle">({t('siteDetail.inactive')})</span>}
                      </span>
                      <span id={`${id}-v`} className="font-mono text-xs text-subtle">
                        {t(`siteDetail.type.${c.type}` as MessageKey)} · {c.version ?? '—'}{updatable ? ` → ${c.latest_version}` : ''}
                      </span>
                    </span>
                  </label>
                  {updatable
                    ? <span className="badge badge-warn">{t('siteDetail.updateTo', { version: c.latest_version! })}</span>
                    : <span className="text-xs text-muted">{t('siteDetail.upToDate')}</span>}
                </li>
              )
            })}
          </ul>
        )}
      </form>
    </section>
  )
}
