import type { Json } from '@/lib/database.types'
import { createTranslator, isLocale, type Locale } from '@/lib/i18n/core'
import { ruleDiagnosis, type Diagnosis, type Evidence } from '@/lib/diagnosis/rules'
import { DiagnosisApiError, refineWithClaude } from '@/lib/diagnosis/claude'
import type { Admin, Run } from './run'

interface CheckRow { check: string; ok: boolean; detail?: Record<string, unknown> }
interface Item { type: string; slug: string; name: string; from_version: string | null; to_version: string | null; staging?: string; production?: string }

/** Bouwt het bewijs voor de diagnose uit de run: items, gezakte checks en de foutgegevens van de site. */
export async function buildEvidence(admin: Admin, run: Run): Promise<Evidence> {
  const st = (run.step_state ?? {}) as { diagnostics?: Omit<Evidence, 'items' | 'failures'> & { where: 'staging' | 'production' } | null }
  const where: 'staging' | 'production' = st.diagnostics?.where ?? (run.verdict === 'blocked' ? 'staging' : 'production')
  const phase = where === 'staging' ? 'staging_after' : 'production_after'
  const { data: results } = await admin.from('test_results')
    .select('page_label, page_key, viewport, checks, passed').eq('run_id', run.id).eq('phase', phase).eq('passed', false).order('id')
  const failures = (results ?? []).flatMap(r => ((r.checks ?? []) as unknown as CheckRow[]).filter(c => !c.ok)
    .map(c => ({ page: r.page_key === 'login' ? 'wp-login.php' : r.page_label || r.page_key, viewport: r.viewport, check: c.check, ...(c.detail ? { detail: c.detail } : {}) })))
  const items = (run.items as unknown as Item[]).map(i => ({
    type: i.type, slug: i.slug, name: i.name, from_version: i.from_version, to_version: i.to_version,
    status: (where === 'staging' ? i.staging : i.production) ?? null,
  }))
  return {
    where,
    items,
    failures: failures.slice(0, 10),
    fatals: st.diagnostics?.fatals ?? [],
    log_tail: st.diagnostics?.log_tail ?? [],
    environment: st.diagnostics?.environment ?? null,
  }
}

export interface DiagnoseOptions { apiKey?: string; model?: string; fetch?: typeof fetch; log?: (msg: string, extra?: Record<string, unknown>) => void }

/**
 * Maakt de diagnose voor een tegengehouden of teruggedraaide run (idempotent: bestaat hij al,
 * dan gebeurt er niets). Altijd eerst regelgebaseerd; met een API-sleutel verfijnt Claude die.
 */
export async function diagnoseRun(admin: Admin, run: Run, opts: DiagnoseOptions = {}): Promise<Diagnosis & { source: 'rules' | 'ai' } | null> {
  if (run.status !== 'done' || !['blocked', 'rolled_back'].includes(run.verdict ?? '')) return null
  const { data: existing } = await admin.from('diagnoses').select('run_id').eq('run_id', run.id).maybeSingle()
  if (existing) return null
  const { data: agency } = await admin.from('agencies').select('dashboard_locale').eq('id', run.agency_id).single()
  const locale: Locale = isLocale(agency?.dashboard_locale) ? agency.dashboard_locale : 'en'
  const evidence = await buildEvidence(admin, run)
  let result: Diagnosis & { source: 'rules' | 'ai'; model?: string } = { ...ruleDiagnosis(evidence, createTranslator(locale), locale), source: 'rules' }
  if (opts.apiKey) {
    try {
      const ai = await refineWithClaude(evidence, result, locale, { apiKey: opts.apiKey, model: opts.model, fetch: opts.fetch })
      result = { ...ai, source: 'ai' }
    } catch (err) {
      opts.log?.('diagnosis_ai_failed', { run: run.id, error: err instanceof DiagnosisApiError ? err.message : String(err) })
    }
  }
  const { error } = await admin.from('diagnoses').upsert({
    run_id: run.id, agency_id: run.agency_id, source: result.source, model: result.model ?? null, locale,
    summary: result.summary.slice(0, 400), cause: result.cause.slice(0, 2000), fix: result.fix.slice(0, 2000),
    culprit_slug: result.culprit_slug, culprit_name: result.culprit_name, confidence: result.confidence,
    evidence: evidence as unknown as Json,
  }, { onConflict: 'run_id', ignoreDuplicates: true })
  if (error) throw error
  return result
}
