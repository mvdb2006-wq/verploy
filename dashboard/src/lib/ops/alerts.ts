/**
 * Alarm voor de beheerder van Verploy (niet voor klanten). Supabase roept elke 5 minuten
 * /api/cron/ops aan; die vraagt de database wat er mis is (ops_problems) en mailt alleen bij een
 * verandering: een nieuw probleem, een herinnering als het na REMIND_HOURS nog speelt, of "opgelost".
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

type Admin = SupabaseClient<Database>

export const REMIND_HOURS = 6

export interface Problem { key: string; detail: string }
export interface AlertState { key: string; detail: string | null; first_seen: string; last_notified: string | null; active: boolean }

export interface AlertPlan {
  fresh: Problem[]          // nieuw (of nog nooit gemeld)
  reminders: Problem[]      // speelt nog, laatste melding langer dan REMIND_HOURS geleden
  resolved: AlertState[]    // was actief, nu opgelost
}

/** Puur: wat moet er gemeld worden, gegeven de huidige problemen en wat al bekend was. */
export function planAlerts(problems: Problem[], state: AlertState[], now = Date.now()): AlertPlan {
  const known = new Map(state.map(s => [s.key, s]))
  const current = new Set(problems.map(p => p.key))
  const fresh: Problem[] = []
  const reminders: Problem[] = []
  for (const p of problems) {
    const s = known.get(p.key)
    if (!s || !s.active || !s.last_notified) fresh.push(p)
    else if (now - Date.parse(s.last_notified) >= REMIND_HOURS * 3_600_000) reminders.push(p)
  }
  // Alleen "opgelost" melden voor wat ook echt gemeld was. Fouten (error:…) zijn momentopnamen: die sluiten stil.
  const resolved = state.filter(s => s.active && s.last_notified && !current.has(s.key) && !s.key.startsWith('error:'))
  return { fresh, reminders, resolved }
}

const LABELS: Record<string, string> = {
  worker_down: 'De worker draait niet (updates, rapporten en controles staan stil)',
  runs_stuck: 'Updates blijven hangen',
  heartbeats_silent: 'Er komen geen heartbeats meer binnen van de sites',
  'error:app:auth_mail_failed': 'Supabase kan geen bevestigings- of resetmails versturen (SMTP)',
  'error:app:auth_mail_rate_limited': 'Mailimiet van Supabase bereikt: bevestigings- of resetmails worden geweigerd',
}
export function problemLabel(key: string): string {
  if (LABELS[key]) return LABELS[key]!
  const m = /^error:([^:]+):(.+)$/.exec(key)
  if (m) return `Fout in ${m[1] === 'stripe' ? 'de Stripe-webhook' : m[1] === 'worker' ? 'de worker' : 'de app'}: ${m[2]}`
  return key
}

export function alertMail(plan: AlertPlan, appUrl: string): { subject: string; text: string; html: string } | null {
  const open = [...plan.fresh, ...plan.reminders]
  if (!open.length && !plan.resolved.length) return null
  const subject = open.length
    ? `Verploy alarm: ${problemLabel(open[0]!.key)}${open.length > 1 ? ` (+${open.length - 1})` : ''}`
    : `Verploy: opgelost — ${problemLabel(plan.resolved[0]!.key)}${plan.resolved.length > 1 ? ` (+${plan.resolved.length - 1})` : ''}`
  const blocks: [string, string[]][] = []
  if (plan.fresh.length) blocks.push(['Nieuw', plan.fresh.map(p => `${problemLabel(p.key)} — ${p.detail}`)])
  if (plan.reminders.length) blocks.push([`Speelt nog (herinnering na ${REMIND_HOURS} uur)`, plan.reminders.map(p => `${problemLabel(p.key)} — ${p.detail}`)])
  if (plan.resolved.length) blocks.push(['Opgelost', plan.resolved.map(s => problemLabel(s.key))])
  const text = blocks.map(([h, lines]) => `${h}\n${lines.map(l => `- ${l}`).join('\n')}`).join('\n\n')
    + `\n\nLogs: Railway (worker) en Vercel (app). Overzicht: ${appUrl}`
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${blocks.map(([h, lines]) =>
    `<p style="margin:16px 0 4px"><b>${esc(h)}</b></p><ul style="margin:0">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('')}
<p style="margin-top:16px;color:#666">Logs: Railway (worker) en Vercel (app). Overzicht: <a href="${esc(appUrl)}">${esc(appUrl)}</a></p></div>`
  return { subject, text, html }
}

export interface OpsCheckResult { problems: number; fresh: number; reminders: number; resolved: number; mailed: boolean }

/** Eén controle: problemen ophalen, zo nodig mailen, stand bijwerken. */
export async function checkOps(admin: Admin, send: (to: string, mail: { subject: string; text: string; html: string }) => Promise<boolean>, now = Date.now()): Promise<OpsCheckResult> {
  const [{ data: problems, error: pErr }, { data: state, error: sErr }, { data: config, error: cErr }] = await Promise.all([
    admin.rpc('ops_problems'),
    admin.from('ops_alert_state').select('key, detail, first_seen, last_notified, active'),
    admin.from('ops_config').select('alert_email, app_url').maybeSingle(),
  ])
  if (pErr) throw pErr
  if (sErr) throw sErr
  if (cErr) throw cErr
  const list = (problems ?? []) as Problem[]
  const plan = planAlerts(list, (state ?? []) as AlertState[], now)
  const mail = alertMail(plan, config?.app_url ?? 'https://app.verploy.com')
  const mailed = Boolean(mail && config?.alert_email && await send(config.alert_email, mail))
  const stamp = new Date(now).toISOString()

  // Stand bijwerken. Zonder verstuurde mail blijft "gemeld" leeg, zodat het de volgende keer opnieuw geprobeerd wordt.
  const notified = new Set(mailed ? [...plan.fresh, ...plan.reminders].map(p => p.key) : [])
  const known = new Map((state ?? []).map(s => [s.key, s]))
  const upserts = list.map(p => {
    const s = known.get(p.key)
    return {
      key: p.key, detail: p.detail, active: true,
      first_seen: s?.active ? s.first_seen : stamp,
      last_notified: notified.has(p.key) ? stamp : (s?.active ? s.last_notified : null),
    }
  })
  if (upserts.length) {
    const { error } = await admin.from('ops_alert_state').upsert(upserts)
    if (error) throw error
  }
  const current = new Set(list.map(p => p.key))
  const gone = (state ?? []).filter(s => s.active && !current.has(s.key))
  // Opgelost: pas op inactief zetten als de "opgelost"-mail weg is (of als er nooit een alarm uitging).
  const close = gone.filter(s => mailed || !s.last_notified || s.key.startsWith('error:')).map(s => s.key)
  if (close.length) {
    const { error } = await admin.from('ops_alert_state').update({ active: false }).in('key', close)
    if (error) throw error
  }
  await admin.rpc('ops_prune')
  return { problems: list.length, fresh: plan.fresh.length, reminders: plan.reminders.length, resolved: plan.resolved.length, mailed }
}
