'use client'
import { useActionState } from 'react'
import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import type { MessageKey } from '@/lib/i18n/core'
import { setSiteAutoUpdates } from './actions'

/** Doet deze site mee met de automatische veilige updates van het bureau? Eén knop voor de uitzondering. */
export function SiteAutoUpdates({ siteId, siteOn, window, frequency, canEdit }: {
  siteId: string; siteOn: boolean; window: string; frequency: string; canEdit: boolean
}) {
  const { t } = useI18n()
  const [state, action] = useActionState(setSiteAutoUpdates, {})
  const moment = t(`autoUpdates.windowsShort.${window}` as MessageKey)
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-border bg-surface px-5 py-4" aria-labelledby="site-auto-title">
      <div className="flex min-w-0 items-start gap-3">
        <CalendarClock size={17} className={siteOn ? 'mt-0.5 shrink-0 text-accent' : 'mt-0.5 shrink-0 text-subtle'} aria-hidden />
        <div className="min-w-0">
          <h2 id="site-auto-title" className="text-sm font-semibold">
            {siteOn ? t('autoUpdates.site.on', { moment: moment, frequency: t(`autoUpdates.frequencies.${frequency}` as MessageKey) }) : t('autoUpdates.site.off')}
          </h2>
          <p className="text-xs text-muted">
            {siteOn ? t('autoUpdates.site.onBody') : t('autoUpdates.site.offBody')}{' '}
            <Link href="/settings#auto-updates" className="text-accent hover:underline">{t('autoUpdates.site.settings')}</Link>
          </p>
          {state.error && <div className="mt-2"><Alert>{state.error}</Alert></div>}
        </div>
      </div>
      {canEdit && (
        <form action={action}>
          <input type="hidden" name="site_id" value={siteId} />
          <input type="hidden" name="auto_updates" value={siteOn ? 'off' : 'on'} />
          <SubmitButton variant="ghost" pendingLabel={t('common.saving')}>{t(siteOn ? 'autoUpdates.site.exclude' : 'autoUpdates.site.include')}</SubmitButton>
        </form>
      )}
    </section>
  )
}
