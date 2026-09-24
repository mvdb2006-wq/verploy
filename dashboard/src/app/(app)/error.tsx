'use client'
import { useEffect } from 'react'
import { useI18n } from '@/lib/i18n/client'

/** Onverwachte fout binnen de app: nette melding met opnieuw proberen (details alleen in de serverlog). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n()
  useEffect(() => { console.error(error) }, [error])
  return (
    <section className="card mx-auto mt-10 max-w-lg text-center" role="alert">
      <h1 className="text-xl font-extrabold">{t('errors.errorTitle')}</h1>
      <p className="mt-2 text-sm text-muted">{t('errors.errorBody')}</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-subtle">ref: {error.digest}</p>}
      <button type="button" onClick={reset} className="btn btn-primary mt-5">{t('errors.retry')}</button>
    </section>
  )
}
