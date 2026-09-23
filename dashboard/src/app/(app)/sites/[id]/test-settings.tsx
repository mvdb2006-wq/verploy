'use client'
import { useActionState } from 'react'
import { Alert } from '@/components/Alert'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { saveTestSettings } from './actions'

export function TestSettings({ siteId, paths, masks, threshold }: { siteId: string; paths: string[]; masks: string[]; threshold: number }) {
  const { t } = useI18n()
  const [state, action] = useActionState(saveTestSettings, {})
  return (
    <details className="group rounded-(--radius-card) border border-border bg-surface">
      <summary className="cursor-pointer list-none px-5 py-4 font-bold marker:hidden">
        <span className="mr-2 inline-block text-muted transition-transform group-open:rotate-90" aria-hidden>›</span>
        {t('runs.settings.title')}
      </summary>
      <form action={action} className="space-y-4 border-t border-border px-5 py-5">
        <input type="hidden" name="site_id" value={siteId} />
        <p className="text-sm text-muted">{t('runs.settings.intro')}</p>
        <div>
          <label htmlFor="test_paths" className="label">{t('runs.settings.paths')}</label>
          <textarea id="test_paths" name="test_paths" rows={3} className="input font-mono" defaultValue={paths.join('\n')} placeholder="/contact/&#10;/winkel/" />
          <p className="mt-1 text-xs text-subtle">{t('runs.settings.pathsHelp')}</p>
        </div>
        <div>
          <label htmlFor="test_masks" className="label">{t('runs.settings.masks')}</label>
          <textarea id="test_masks" name="test_masks" rows={3} className="input font-mono" defaultValue={masks.join('\n')} placeholder=".slider&#10;#cookie-banner" />
          <p className="mt-1 text-xs text-subtle">{t('runs.settings.masksHelp')}</p>
        </div>
        <div className="max-w-48">
          <label htmlFor="diff_threshold" className="label">{t('runs.settings.threshold')}</label>
          <input id="diff_threshold" name="diff_threshold" type="number" min={0.1} max={50} step={0.1} className="input" defaultValue={Math.round(threshold * 1000) / 10} />
        </div>
        <p className="text-xs text-subtle">{t('runs.settings.thresholdHelp')}</p>
        <div className="flex items-center gap-3">
          <SubmitButton variant="ghost">{t('common.save')}</SubmitButton>
          {state.saved && <span className="text-sm text-accent" role="status">{t('common.saved')}</span>}
        </div>
        {state.error && <Alert>{state.error}</Alert>}
      </form>
    </details>
  )
}
