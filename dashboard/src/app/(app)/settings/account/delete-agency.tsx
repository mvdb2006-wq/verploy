'use client'
import { useActionState } from 'react'
import { Alert } from '@/components/Alert'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { deleteAgency } from './actions'

/** Bureau en account verwijderen: alleen voor de eigenaar, met de naam van het bureau als bevestiging. */
export function DeleteAgency({ name, members, subscribed }: { name: string; members: number; subscribed: boolean }) {
  const { t } = useI18n()
  const [state, action] = useActionState(deleteAgency, {})
  return (
    <section className="rounded-(--radius-card) border border-danger/25 p-6" aria-labelledby="delete-agency-title">
      <h2 id="delete-agency-title" className="font-bold text-danger">{t('accountDelete.title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('accountDelete.body', { name })}</p>
      <ul className="mt-2 mb-4 list-disc space-y-0.5 pl-5 text-sm text-muted">
        <li>{t('accountDelete.whatData')}</li>
        {members > 1 && <li>{t('accountDelete.whatTeam', { count: members - 1 })}</li>}
        <li>{subscribed ? t('accountDelete.whatSubscription') : t('accountDelete.whatNoSubscription')}</li>
        <li>{t('accountDelete.whatConnector')}</li>
      </ul>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="delete-agency-confirm" className="label">{t('accountDelete.confirm', { name })}</label>
          <input id="delete-agency-confirm" name="confirm" className="input" autoComplete="off" required />
        </div>
        <SubmitButton variant="danger" pendingLabel={t('accountDelete.pending')}>{t('accountDelete.button')}</SubmitButton>
      </form>
      {state.error && <Alert className="mt-3">{state.error}</Alert>}
    </section>
  )
}
