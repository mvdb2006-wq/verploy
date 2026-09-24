'use client'
import { useActionState, useState } from 'react'
import { Download, Eye, Trash2 } from 'lucide-react'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { deleteReport } from './actions'

/** Bekijken, downloaden en (voor beheerders) verwijderen, met een bevestiging in de rij zelf. */
export function ReportRowActions({ id, hasPdf, canDelete, busy }: { id: string; hasPdf: boolean; canDelete: boolean; busy: boolean }) {
  const { t } = useI18n()
  const [confirming, setConfirming] = useState(false)
  const [state, action] = useActionState(deleteReport, {})
  if (state.ok) return <span className="text-xs text-accent" role="status">{state.ok}</span>
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5" role="group" aria-label={t('reports.actions')}>
      {confirming ? (
        <form action={action} className="flex flex-wrap items-center justify-end gap-2">
          <input type="hidden" name="report_id" value={id} />
          <span className="text-xs text-muted">{t('reports.deleteConfirm')}</span>
          <SubmitButton variant="danger" className="px-2.5 py-1 text-xs" pendingLabel={t('common.saving')}>{t('reports.deleteYes')}</SubmitButton>
          <button type="button" className="btn btn-ghost px-2.5 py-1 text-xs" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
        </form>
      ) : (
        <>
          {hasPdf && (
            <>
              <a href={`/report-files/${id}?view=1`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                <Eye size={13} aria-hidden /> {t('reports.view')}
              </a>
              <a href={`/report-files/${id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                <Download size={13} aria-hidden /> {t('reports.downloadShort')}
              </a>
            </>
          )}
          {canDelete && !busy && (
            <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-danger">
              <Trash2 size={13} aria-hidden /> {t('common.delete')}
            </button>
          )}
        </>
      )}
      {state.error && <span className="w-full text-right text-xs text-danger" role="alert">{state.error}</span>}
    </div>
  )
}
