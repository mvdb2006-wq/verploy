'use client'
import { useActionState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { fixComponent, fixVulnerability } from '@/app/(app)/inbox/actions'

/**
 * Eén knop voor alle getroffen sites (gewone veilige updates, per site): voor één lek (Beveiliging)
 * of voor één onderdeel (Inbox).
 */
export function FixButton({ vulnerabilityId, component, siteIds, variant = 'primary' }: {
  vulnerabilityId?: string; component?: { type: string; slug: string }; siteIds: string[]; variant?: 'primary' | 'ghost'
}) {
  const { t } = useI18n()
  const [state, action] = useActionState(component ? fixComponent : fixVulnerability, {})
  if (state.ok) return <p className="text-sm text-accent" role="status">{state.ok}</p>
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {vulnerabilityId && <input type="hidden" name="vulnerability_id" value={vulnerabilityId} />}
      {component && <><input type="hidden" name="component_type" value={component.type} /><input type="hidden" name="component_slug" value={component.slug} /></>}
      {siteIds.map(id => <input key={id} type="hidden" name="site_id" value={id} />)}
      <SubmitButton variant={variant} pendingLabel={t('runs.panel.starting')}>
        <ShieldCheck size={15} aria-hidden /> {t('ops.inbox.approveButton', { count: siteIds.length })}
      </SubmitButton>
      {state.error && <span className="text-sm text-danger" role="alert">{state.error}</span>}
    </form>
  )
}
