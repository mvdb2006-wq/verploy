import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { DEFAULT_LOCALE, createTranslator, isLocale } from '@/lib/i18n/core'
import { env } from '@/lib/env'
import { renderEmail, sendEmail, type OutgoingEmail } from '@/lib/email'
import type { RunItem } from '@/lib/run-items'
import { buildDigest, type DigestRun } from './build'

type Admin = SupabaseClient<Database>
const SERIOUS = ['high', 'critical']

export interface DigestResult { claimed: number; sent: number; skipped: number }

/**
 * Ochtendmail "Afgelopen nacht" (worker, service role). Zonder e-mailprovider wordt niets geclaimd,
 * zodat de mail niet stilletjes verdwijnt. Niets te melden: geen mail (wel als verstuurd gemarkeerd).
 */
export async function sendDailyDigests(admin: Admin, opts: { send?: (m: OutgoingEmail) => Promise<boolean>; emailConfigured?: boolean; appUrl?: string } = {}): Promise<DigestResult> {
  const result: DigestResult = { claimed: 0, sent: 0, skipped: 0 }
  if (!(opts.emailConfigured ?? Boolean(env().RESEND_API_KEY))) return result
  const send = opts.send ?? sendEmail
  const appUrl = opts.appUrl ?? env().NEXT_PUBLIC_APP_URL
  const { data: due, error } = await admin.rpc('claim_daily_digests', { p_hour: 7, p_limit: 50 })
  if (error) throw error
  for (const a of due ?? []) {
    result.claimed++
    const [{ data: sites }, { data: runs }, { data: alerts }, { data: vulns }] = await Promise.all([
      admin.from('sites').select('id, name').eq('agency_id', a.agency_id),
      admin.from('update_runs').select('site_id, status, verdict, trigger, items, reason_key, reason_params')
        .eq('agency_id', a.agency_id).eq('status', 'done').gte('finished_at', a.since).order('finished_at'),
      admin.from('alerts').select('type, severity, acknowledged_at').eq('agency_id', a.agency_id).eq('status', 'open'),
      admin.from('site_vulnerabilities').select('component_type, component_slug, severity, fixable').eq('agency_id', a.agency_id).eq('status', 'open'),
    ])
    const names = new Map((sites ?? []).map(s => [s.id, s.name]))
    const digestRuns: DigestRun[] = (runs ?? []).map(r => ({
      siteName: names.get(r.site_id) ?? '—', status: r.status, verdict: r.verdict, trigger: r.trigger,
      items: r.items as unknown as RunItem[], reasonKey: r.reason_key, reasonParams: r.reason_params,
    }))
    const openAlerts = (alerts ?? []).filter(x => x.severity !== 'info' && !x.acknowledged_at && x.type !== 'vulnerability')
    const vulnComponents = new Set((vulns ?? []).filter(v => SERIOUS.includes(v.severity)).map(v => `${v.component_type}:${v.component_slug}`))
    const decisions = openAlerts.filter(x => x.type === 'update_approval').length + vulnComponents.size
    const problems = openAlerts.filter(x => x.type !== 'update_approval').length

    const t = createTranslator(isLocale(a.locale) ? a.locale : DEFAULT_LOCALE)
    const digest = buildDigest(t, { agencyName: a.agency_name, runs: digestRuns, decisions, problems })
    if (!digest || !a.recipients.length) { result.skipped++; continue }
    const mail = renderEmail({
      heading: digest.heading, body: digest.intro, sections: digest.sections, cta: digest.cta,
      url: `${appUrl}${decisions + problems ? '/inbox' : '/'}`, footer: t('digest.footer', { agency: a.agency_name }),
    })
    const day = new Date().toISOString().slice(0, 10)
    const sent = await Promise.all(a.recipients.map(to => send({ to, subject: digest.subject, ...mail, idempotencyKey: `digest-${a.agency_id}-${day}-${to}` })))
    if (sent.every(Boolean)) result.sent++
  }
  return result
}
