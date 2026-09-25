'use client'
import { useActionState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { approveUpdates } from '@/app/(app)/inbox/actions'

/** Akkoord op updates die Verploy niet zelf deed (grote versiesprong): één veilige update, eerst op een testkopie. */
export function ApproveUpdatesButton({ alertId, count }: { alertId: string; count: number }) {
  const { t } = useI18n()
  const [state, action] = useActionState(approveUpdates, {})
  if (state.ok) return <p className="text-sm text-accent" role="status">{state.ok}</p>
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="alert_id" value={alertId} />
      <SubmitButton pendingLabel={t('runs.panel.starting')}>
        <ShieldCheck size={15} aria-hidden /> {t('autoUpdates.approveButton', { count })}
      </SubmitButton>
      {state.error && <span className="text-sm text-danger" role="alert">{state.error}</span>}
    </form>
  )
}
