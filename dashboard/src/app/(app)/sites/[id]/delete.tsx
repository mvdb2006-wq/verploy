'use client'
import { useActionState } from 'react'
import { Alert } from '@/components/Alert'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { deleteSite } from './actions'

export function DeleteSite({ siteId, name }: { siteId: string; name: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(deleteSite, {})
  return (
    <section className="rounded-(--radius-card) border border-danger/25 p-6" aria-labelledby="danger-title">
      <h2 id="danger-title" className="font-bold text-danger">{t('siteDetail.dangerTitle')}</h2>
      <p className="mt-1 mb-4 text-sm text-muted">{t('siteDetail.dangerBody')}</p>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="site_id" value={siteId} />
        <div className="min-w-56 flex-1">
          <label htmlFor="confirm" className="label">{t('siteDetail.deleteConfirm', { name })}</label>
          <input id="confirm" name="confirm" className="input" autoComplete="off" />
        </div>
        <SubmitButton variant="danger">{t('siteDetail.deleteButton')}</SubmitButton>
      </form>
      {state.error && <Alert className="mt-3">{state.error}</Alert>}
    </section>
  )
}
