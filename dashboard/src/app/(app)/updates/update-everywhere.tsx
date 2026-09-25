'use client'
import { useActionState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { updateEverywhere } from './actions'

export function UpdateEverywhere({ type, slug, count, disabled }: { type: string; slug: string; count: number; disabled: boolean }) {
  const { t } = useI18n()
  const [state, action] = useActionState(updateEverywhere, {})
  if (state.ok) return <p className="text-sm text-accent" role="status">{state.ok}</p>
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="slug" value={slug} />
      {!disabled && (
        <SubmitButton pendingLabel={t('runs.panel.starting')}>
          <ShieldCheck size={15} aria-hidden /> {t('bulk.button', { count })}
        </SubmitButton>
      )}
      {state.error && <span className="text-sm text-danger" role="alert">{state.error}</span>}
    </form>
  )
}
