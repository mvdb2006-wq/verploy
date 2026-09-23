'use client'
import { useActionState } from 'react'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { cancelRun } from './actions'

export function CancelRun({ runId, siteId }: { runId: string; siteId: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(cancelRun, {})
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="site_id" value={siteId} />
      <SubmitButton variant="ghost" pendingLabel={t('runs.detail.cancelling')}>{t('runs.detail.cancel')}</SubmitButton>
      {state.error && <span className="text-xs text-danger" role="alert">{state.error}</span>}
    </form>
  )
}
