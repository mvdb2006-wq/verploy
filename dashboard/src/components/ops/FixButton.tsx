'use client'
import { useActionState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { fixVulnerability } from '@/app/(app)/inbox/actions'

/** Eén knop voor alle getroffen sites van één lek (gewone veilige updates, per site). */
export function FixButton({ vulnerabilityId, siteIds, variant = 'primary' }: { vulnerabilityId: string; siteIds: string[]; variant?: 'primary' | 'ghost' }) {
  const { t } = useI18n()
  const [state, action] = useActionState(fixVulnerability, {})
  if (state.ok) return <p className="text-sm text-accent" role="status">{state.ok}</p>
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="vulnerability_id" value={vulnerabilityId} />
      {siteIds.map(id => <input key={id} type="hidden" name="site_id" value={id} />)}
      <SubmitButton variant={variant} pendingLabel={t('runs.panel.starting')}>
        <ShieldCheck size={15} aria-hidden /> {t('ops.inbox.approveButton', { count: siteIds.length })}
      </SubmitButton>
      {state.error && <span className="text-sm text-danger" role="alert">{state.error}</span>}
    </form>
  )
}
