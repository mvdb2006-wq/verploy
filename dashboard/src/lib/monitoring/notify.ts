import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { DEFAULT_LOCALE, createTranslator, isLocale, type MessageKey } from '@/lib/i18n/core'
import { formatDate } from '@/lib/format'
import { env } from '@/lib/env'
import { renderEmail, sendEmail, type OutgoingEmail } from '@/lib/email'
import { presentAlert } from './present'

type Send = (mail: OutgoingEmail) => Promise<boolean>

export interface DispatchResult { claimed: number; sent: number; failed: number; skipped: boolean }

/**
 * Verstuurt openstaande meldingen (openen + herstel) per e-mail naar eigenaren en
 * beheerders, in de taal van het bureau. Claim → versturen → bevestigen; mislukt
 * versturen gaat terug in de wachtrij (max. 5 pogingen, zie de migratie).
 */
export async function dispatchNotifications(
  admin: SupabaseClient<Database>,
  opts: { limit?: number; send?: Send; emailConfigured?: boolean; appUrl?: string } = {},
): Promise<DispatchResult> {
  const configured = opts.emailConfigured ?? Boolean(env().RESEND_API_KEY)
  // Zonder e-mailprovider niets claimen: meldingen blijven wachten tot e-mail werkt (in-app zijn ze al zichtbaar).
  if (!configured) return { claimed: 0, sent: 0, failed: 0, skipped: true }
  const send = opts.send ?? sendEmail
  const appUrl = opts.appUrl ?? env().NEXT_PUBLIC_APP_URL

  const { data: rows, error } = await admin.rpc('claim_alert_notifications', { p_limit: opts.limit ?? 25 })
  if (error) throw error
  let sent = 0
  let failed = 0
  for (const n of rows ?? []) {
    const locale = isLocale(n.locale) ? n.locale : DEFAULT_LOCALE
    const t = createTranslator(locale)
    const siteVars = { site: n.site_name, url: n.site_url.replace(/^https?:\/\//, ''), agency: n.agency_name }
    let subject: string
    let heading: string
    let body: string
    if (n.kind === 'resolved') {
      const since = (n.params as { since?: string } | null)?.since
      subject = t('email.recoveredSubject', siteVars)
      heading = subject
      body = t('email.recoveredBody', { ...siteVars, since: since ? formatDate(since, locale, true) : '—' })
    } else {
      const { title, body: explanation } = presentAlert(t, locale, n)
      subject = t('email.alertSubject', { ...siteVars, title, severity: t(`alerts.severity.${n.severity}` as MessageKey) })
      heading = title
      body = `${t('email.alertIntro', siteVars)} ${explanation}`
    }
    const runId = (n.params as { run_id?: unknown } | null)?.run_id
    const url = typeof runId === 'string' ? `${appUrl}/sites/${n.site_id}/runs/${runId}` : `${appUrl}/sites/${n.site_id}`
    const mail = renderEmail({ heading, body, cta: t('email.alertCta'), url, footer: t('email.alertFooter', siteVars) })
    const results = await Promise.all(n.recipients.map(to => send({ to, subject, ...mail })))
    const ok = results.every(Boolean)
    await admin.rpc('complete_alert_notification', { p_alert: n.alert_id, p_kind: n.kind, p_sent: ok })
    if (ok) sent++
    else failed++
  }
  return { claimed: rows?.length ?? 0, sent, failed, skipped: false }
}
