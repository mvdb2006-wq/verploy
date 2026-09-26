/**
 * Interne melding bij een nieuwe registratie (naar ops_config.alert_email). De wachtrij vult een trigger op
 * auth.users; deze functie draait mee met de controle van elke 5 minuten (/api/cron/ops).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

type Admin = SupabaseClient<Database>

export interface SignupNotice {
  user_id: string; email: string; intended_plan: string | null; created_at: string
  attempts: number; confirmed: boolean; agency_name: string | null; invited: boolean
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function signupMail(n: SignupNotice): { subject: string; text: string; html: string } {
  const when = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }).format(new Date(n.created_at))
  const rows: [string, string][] = [
    ['Email', n.email],
    ['Time', `${when} (Amsterdam)`],
    ['Intended plan', n.intended_plan ?? 'none'],
    ['Email confirmed', n.confirmed ? 'yes' : 'not yet'],
    ['Agency', n.agency_name ?? (n.invited ? 'joining via team invitation' : 'not created yet')],
  ]
  const text = `New Verploy signup\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n`
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5"><p><b>New Verploy signup</b></p><table cellpadding="4" cellspacing="0">${
    rows.map(([k, v]) => `<tr><td style="color:#666;padding-right:16px">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>`
  return { subject: `New Verploy signup: ${n.email}`, text, html }
}

export interface SignupNoticeResult { pending: number; sent: number }

export async function sendSignupNotices(admin: Admin, send: (to: string, mail: { subject: string; text: string; html: string }, key: string) => Promise<boolean>): Promise<SignupNoticeResult> {
  const { data: config } = await admin.from('ops_config').select('alert_email').maybeSingle()
  if (!config?.alert_email) return { pending: 0, sent: 0 }
  const { data, error } = await admin.rpc('pending_signup_notices', { p_limit: 20 })
  if (error) throw error
  const out: SignupNoticeResult = { pending: data?.length ?? 0, sent: 0 }
  for (const n of (data ?? []) as SignupNotice[]) {
    const ok = await send(config.alert_email, signupMail(n), `signup-${n.user_id}`)
    const { error: uErr } = await admin.from('signup_notices')
      .update(ok ? { sent_at: new Date().toISOString() } : { attempts: n.attempts + 1 }).eq('user_id', n.user_id)
    if (uErr) throw uErr
    if (ok) out.sent++
  }
  return out
}
