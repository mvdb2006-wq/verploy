'use client'
import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Download } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { CopyField } from '@/components/CopyField'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { formatTime } from '@/lib/format'
import { createPairingCode } from './actions'

export function PairingPanel({ siteId, connected }: { siteId: string; connected: boolean }) {
  const { t, locale } = useI18n()
  const router = useRouter()
  const [state, action] = useActionState(createPairingCode, {})

  // Zolang er een code openstaat: elke 4 s verversen tot de plugin gekoppeld is.
  useEffect(() => {
    if (!state.code) return
    const id = setInterval(() => router.refresh(), 4000)
    return () => clearInterval(id)
  }, [state.code, router])

  return (
    <section className="card space-y-5" aria-labelledby="pair-title">
      <div>
        <h2 id="pair-title" className="text-lg font-bold">{connected ? t('siteDetail.repairTitle') : t('siteDetail.connectTitle')}</h2>
        <p className="mt-1 text-sm text-muted">{connected ? t('siteDetail.repairBody') : t('siteDetail.connectIntro')}</p>
      </div>
      {!connected && (
        <ol className="space-y-2 text-sm text-muted">
          {(['step1', 'step2', 'step3'] as const).map((k, i) => (
            <li key={k} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/10 font-mono text-xs font-bold text-accent" aria-hidden>{i + 1}</span>
              <span className="pt-0.5">{t(`siteDetail.${k}`)}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-3">
        {!connected && (
          <a href="/api/v1/plugin/download" className="btn btn-ghost"><Download size={15} aria-hidden /> {t('siteDetail.download')}</a>
        )}
        <form action={action}>
          <input type="hidden" name="site_id" value={siteId} />
          <SubmitButton variant={state.code ? 'ghost' : 'primary'}>{state.code ? t('siteDetail.regenerate') : t('siteDetail.generate')}</SubmitButton>
        </form>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.code && (
        <div className="space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-4">
          <CopyField value={state.code} label={t('siteDetail.codeLabel')} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} large />
          <p className="text-xs text-muted">{t('siteDetail.codeExpires', { time: formatTime(state.expiresAt!, locale) })}</p>
          <p className="flex items-center gap-2 text-xs text-muted" role="status">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden /> {t('siteDetail.waiting')}
          </p>
        </div>
      )}
    </section>
  )
}
