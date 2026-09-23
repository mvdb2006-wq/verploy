import 'server-only'
import { Resend } from 'resend'
import { env } from '@/lib/env'

export interface OutgoingEmail { to: string; subject: string; html: string; text: string }

/**
 * Verstuurt via Resend. Zonder RESEND_API_KEY wordt er niets verstuurd en geeft
 * de functie `false` terug; de UI toont dan de link om zelf te delen (BLOCKERS #5).
 */
export async function sendEmail(mail: OutgoingEmail): Promise<boolean> {
  const e = env()
  if (!e.RESEND_API_KEY) return false
  const resend = new Resend(e.RESEND_API_KEY)
  const { error } = await resend.emails.send({ from: e.RESEND_FROM, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text })
  if (error) {
    console.error('[email] versturen mislukt:', error.name, error.message)
    return false
  }
  return true
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Eenvoudige, overal goed renderende HTML-mail in Verploy-stijl. */
export function renderEmail(opts: { heading: string; body: string; cta: string; url: string; footer: string }): { html: string; text: string } {
  const html = `<!doctype html><html><body style="margin:0;background:#080C16;font-family:Inter,Segoe UI,Arial,sans-serif;color:#F0F4FF">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0F1629;border:1px solid #1E2D4A;border-radius:12px;padding:32px">
<tr><td style="font-size:18px;font-weight:800;letter-spacing:-0.5px"><span style="color:#F0F4FF">ver</span><span style="color:#22D98A">ploy</span></td></tr>
<tr><td style="padding-top:24px;font-size:20px;font-weight:700">${esc(opts.heading)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#C8D2E8">${esc(opts.body)}</td></tr>
<tr><td style="padding-top:24px"><a href="${esc(opts.url)}" style="display:inline-block;background:#22D98A;color:#080C16;font-weight:700;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:8px">${esc(opts.cta)}</a></td></tr>
<tr><td style="padding-top:24px;font-size:12px;line-height:1.6;color:#8896B3">${esc(opts.footer)}</td></tr>
</table></td></tr></table></body></html>`
  const text = `${opts.heading}\n\n${opts.body}\n\n${opts.cta}: ${opts.url}\n\n${opts.footer}`
  return { html, text }
}
