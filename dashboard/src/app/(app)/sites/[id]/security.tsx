'use client'
import { useActionState } from 'react'
import Link from 'next/link'
import { ExternalLink, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { SubmitButton } from '@/components/SubmitButton'
import { RunBadge } from '@/components/RunBadge'
import { useI18n } from '@/lib/i18n/client'
import type { MessageKey } from '@/lib/i18n/core'
import type { Tone } from '@/lib/runs'
import { compareVersions } from '@/lib/vulnerabilities/version'
import { startRun } from './actions'

export interface SecurityFinding {
  vulnerabilityId: string
  type: string
  slug: string
  name: string
  installed: string
  fixed: string | null
  fixable: boolean
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  cve: string | null
  cvss: number | null
  url: string | null
  mitre: boolean
  autofixRun: { id: string; label: string; tone: Tone } | null
}

export interface Attribution { notice: string; license: string; license_url: string }

const SEVERITY_TONE = { critical: 'badge-danger', high: 'badge-danger', medium: 'badge-warn', low: 'badge-muted' } as const

/** Bekende kwetsbaarheden van deze site, per onderdeel, met "Veilig oplossen". */
export function SecurityPanel({ siteId, findings, checkedAt, runnable, activeRunId, autofix, attribution }: {
  siteId: string
  findings: SecurityFinding[]
  checkedAt: string | null
  runnable: boolean
  activeRunId: string | null
  autofix: boolean
  attribution: { defiant?: Attribution; mitre?: Attribution }
}) {
  const { t } = useI18n()
  const [state, action] = useActionState(startRun, {})

  // Groeperen per onderdeel (één knop per plugin, ook als er meerdere lekken in zitten).
  const groups = new Map<string, SecurityFinding[]>()
  for (const f of findings) groups.set(`${f.type}:${f.slug}`, [...(groups.get(`${f.type}:${f.slug}`) ?? []), f])
  const fixableIds = [...groups.entries()].filter(([, fs]) => fs.some(f => f.fixable)).map(([id]) => id)
  const canFix = runnable && !activeRunId
  const serious = findings.some(f => f.severity === 'high' || f.severity === 'critical')

  return (
    <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="security-title">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id="security-title" className="flex items-center gap-2 font-bold">
            {findings.length ? <ShieldAlert size={17} className={serious ? 'text-danger' : 'text-warn'} aria-hidden /> : <ShieldCheck size={17} className="text-accent" aria-hidden />}
            {t('security.title')}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {findings.length ? t('security.summary', { count: findings.length, components: groups.size }) : t('security.none')}
          </p>
        </div>
        {canFix && fixableIds.length > 1 && (
          <form action={action}>
            <input type="hidden" name="site_id" value={siteId} />
            {fixableIds.map(id => <input key={id} type="hidden" name="item" value={id} />)}
            <SubmitButton pendingLabel={t('runs.panel.starting')}>
              <ShieldCheck size={15} aria-hidden /> {t('security.fixAll', { count: fixableIds.length })}
            </SubmitButton>
          </form>
        )}
      </header>

      {findings.length > 0 && serious && (
        <p className="border-b border-border bg-accent/5 px-5 py-3 text-sm">
          {autofix ? t('security.autofixOn') : t('security.autofixOff')}{' '}
          <Link href="/settings#security" className="font-semibold text-accent hover:underline">{t('security.changeSetting')}</Link>
        </p>
      )}
      {activeRunId && findings.length > 0 && (
        <p className="border-b border-border px-5 py-3 text-sm" role="status">
          {t('runs.panel.active')}{' '}
          <Link href={`/sites/${siteId}/runs/${activeRunId}`} className="font-semibold text-accent hover:underline">{t('runs.panel.view')}</Link>
        </p>
      )}
      {state.error && <div className="border-b border-border px-5 py-3"><Alert>{state.error}</Alert></div>}

      {findings.length > 0 && (
        <ul className="divide-y divide-border/60">
          {[...groups.entries()].map(([id, fs]) => {
            const first = fs[0]!
            const fix = fs.find(f => f.fixable)
            const fixedIn = fs.map(f => f.fixed).filter((v): v is string => Boolean(v)).sort(compareVersions).at(-1) ?? null
            const run = fs.find(f => f.autofixRun)?.autofixRun ?? null
            return (
              <li key={id} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{first.name}</p>
                    <p className="font-mono text-xs text-subtle">
                      {t(`siteDetail.type.${first.type}` as MessageKey)} · {first.installed}
                      {fixedIn ? ` · ${t('security.fixedIn', { version: fixedIn })}` : ` · ${t('security.noFix')}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {run && (
                      <Link href={`/sites/${siteId}/runs/${run.id}`} className="inline-flex items-center gap-2 text-xs text-muted hover:text-text">
                        {t('security.autofixRun')} <RunBadge label={run.label} tone={run.tone} />
                      </Link>
                    )}
                    {fix && canFix && (
                      <form action={action}>
                        <input type="hidden" name="site_id" value={siteId} />
                        <input type="hidden" name="item" value={id} />
                        <SubmitButton variant="ghost" pendingLabel={t('runs.panel.starting')}>
                          <ShieldCheck size={15} aria-hidden /> {t('security.fix')}
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {fs.map(f => (
                    <li key={f.vulnerabilityId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                      <span className={`badge ${SEVERITY_TONE[f.severity]}`}>{t(`security.severity.${f.severity}` as MessageKey)}</span>
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="min-w-0 [overflow-wrap:anywhere] hover:text-accent">
                          {f.title} <ExternalLink size={11} className="inline" aria-hidden />
                        </a>
                      ) : <span className="min-w-0 [overflow-wrap:anywhere]">{f.title}</span>}
                      {(f.cve || f.cvss !== null) && (
                        <span className="font-mono text-xs text-subtle">{[f.cve, f.cvss !== null ? `CVSS ${f.cvss.toFixed(1)}` : null].filter(Boolean).join(' · ')}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {!fix && fixedIn === null && <p className="text-xs text-muted">{t('security.noFixAdvice')}</p>}
                {!fix && fixedIn !== null && <p className="text-xs text-muted">{t('security.fixNotOffered', { version: fixedIn })}</p>}
              </li>
            )
          })}
        </ul>
      )}

      <footer className="border-t border-border px-5 py-3 text-xs text-subtle">
        {checkedAt && <span>{t('security.checkedAt', { date: checkedAt })} · </span>}
        {t('security.source')}
        {(attribution.defiant || (attribution.mitre && findings.some(f => f.mitre))) && (
          <details className="mt-1">
            <summary className="cursor-pointer hover:text-muted">{t('security.licence')}</summary>
            <div className="mt-2 space-y-2">
              {attribution.defiant && <p>{attribution.defiant.notice}. {attribution.defiant.license}</p>}
              {attribution.mitre && findings.some(f => f.mitre) && <p>{attribution.mitre.notice}. {attribution.mitre.license}</p>}
            </div>
          </details>
        )}
      </footer>
    </section>
  )
}
