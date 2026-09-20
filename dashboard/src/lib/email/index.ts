/**
 * Verploy email system via Resend
 * https://resend.com
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM = process.env.RESEND_FROM_EMAIL || 'hello@verploy.com'
const FROM_NAME = 'Verploy'
const RESEND_URL = 'https://api.resend.com/emails'

interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  replyTo?: string
}

export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — skipping email')
    return false
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM}>`,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
        reply_to: opts.replyTo,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[email] Resend error:', err)
      return false
    }

    return true
  } catch (err) {
    console.error('[email] Send failed:', err)
    return false
  }
}

// ── Email templates ──────────────────────────────────────────

export async function sendWelcomeEmail(to: string, agencyName: string) {
  return sendEmail({
    to,
    subject: `Welcome to Verploy, ${agencyName}!`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8FAFF;font-family:Inter,system-ui,sans-serif">
<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #DDE4F0">
  <div style="background:#080C16;padding:28px 32px;display:flex;align-items:center;gap:12px">
    <span style="font-size:22px;font-weight:900;color:#fff">ver<span style="color:#22D98A">ploy</span></span>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:800;color:#0D1526;margin:0 0 16px">Welcome to Verploy 👋</h1>
    <p style="font-size:15px;color:#5A6E8C;line-height:1.65;margin:0 0 20px">
      Your agency <strong style="color:#0D1526">${agencyName}</strong> is now set up on Verploy.
      You have a 14-day free trial — no credit card needed.
    </p>
    <p style="font-size:15px;color:#5A6E8C;line-height:1.65;margin:0 0 24px">
      <strong style="color:#0D1526">Your next step:</strong> Add your first site and install the Verploy connector plugin on your client's WordPress.
    </p>
    <a href="https://app.verploy.com/dashboard"
       style="display:inline-block;background:#22D98A;color:#080C16;font-size:14px;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none">
      Go to your dashboard →
    </a>
    <hr style="border:none;border-top:1px solid #DDE4F0;margin:32px 0">
    <p style="font-size:12px;color:#A0B0CC;margin:0">
      Questions? Reply to this email or reach us at <a href="mailto:hello@verploy.com" style="color:#22D98A">hello@verploy.com</a><br>
      Verploy · Built by EM Hosting en Design · The Netherlands
    </p>
  </div>
</div>
</body>
</html>`,
  })
}

export async function sendAlertEmail(
  to: string,
  alert: { severity: string; title: string; message: string; siteUrl: string; runId?: string }
) {
  const colors = {
    critical: { bg: '#FEF2F2', border: '#EF4444', badge: '#EF4444', label: '🔴 CRITICAL ALERT' },
    warning:  { bg: '#FFFBEB', border: '#F59E0B', badge: '#F59E0B', label: '🟡 WARNING' },
    info:     { bg: '#EFF6FF', border: '#3B82F6', badge: '#3B82F6', label: 'ℹ️ INFO' },
  }
  const c = colors[alert.severity as keyof typeof colors] || colors.info

  return sendEmail({
    to,
    subject: `[Verploy] ${alert.title}`,
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#F8FAFF;font-family:Inter,system-ui,sans-serif">
<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #DDE4F0">
  <div style="background:#080C16;padding:20px 32px">
    <span style="font-size:18px;font-weight:900;color:#fff">ver<span style="color:#22D98A">ploy</span></span>
  </div>
  <div style="background:${c.bg};border-left:4px solid ${c.border};padding:16px 24px;margin:24px 24px 0">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${c.badge};margin-bottom:6px">${c.label}</div>
    <div style="font-size:16px;font-weight:700;color:#0D1526">${alert.title}</div>
  </div>
  <div style="padding:24px 32px">
    <p style="font-size:14px;color:#5A6E8C;line-height:1.65;margin:0 0 8px">
      <strong style="color:#0D1526">Site:</strong> ${alert.siteUrl}
    </p>
    ${alert.message ? `<p style="font-size:14px;color:#5A6E8C;line-height:1.65;margin:0 0 24px">${alert.message}</p>` : ''}
    <a href="https://app.verploy.com/alerts"
       style="display:inline-block;background:#080C16;color:#fff;font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">
      View in dashboard →
    </a>
    <hr style="border:none;border-top:1px solid #DDE4F0;margin:24px 0">
    <p style="font-size:11px;color:#A0B0CC;margin:0">
      Verploy · <a href="https://app.verploy.com/settings" style="color:#A0B0CC">Manage notifications</a>
    </p>
  </div>
</div>
</body>
</html>`,
  })
}

export async function sendUpdateResultEmail(
  to: string,
  result: {
    siteName: string
    siteUrl: string
    passed: boolean
    pluginCount: number
    aiDiagnosis?: string | null
    runId: string
  }
) {
  const { siteName, siteUrl, passed, pluginCount, aiDiagnosis, runId } = result

  return sendEmail({
    to,
    subject: passed
      ? `✅ ${pluginCount} update(s) deployed on ${siteName}`
      : `❌ Update failed on ${siteName} — action needed`,
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#F8FAFF;font-family:Inter,system-ui,sans-serif">
<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #DDE4F0">
  <div style="background:#080C16;padding:20px 32px">
    <span style="font-size:18px;font-weight:900;color:#fff">ver<span style="color:#22D98A">ploy</span></span>
  </div>
  <div style="padding:32px">
    <div style="font-size:32px;margin-bottom:12px">${passed ? '✅' : '❌'}</div>
    <h1 style="font-size:20px;font-weight:800;color:#0D1526;margin:0 0 8px">
      ${passed ? `${pluginCount} plugin update(s) deployed safely` : `Update failed — site protected`}
    </h1>
    <p style="font-size:14px;color:#5A6E8C;margin:0 0 24px">
      <strong style="color:#0D1526">Site:</strong> ${siteName} (${siteUrl})
    </p>
    ${passed ? `
    <p style="font-size:14px;color:#5A6E8C;line-height:1.65;margin:0 0 24px">
      Verploy ran automated UI tests and visual checks on staging — everything passed.
      The ${pluginCount} update(s) were automatically deployed to production.
    </p>
    ` : `
    <p style="font-size:14px;color:#5A6E8C;line-height:1.65;margin:0 0 16px">
      The update was blocked because tests failed on staging. Your production site was <strong style="color:#0D1526">not modified</strong>.
    </p>
    ${aiDiagnosis ? `
    <div style="background:#FEF2F2;border-left:3px solid #EF4444;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#EF4444;margin-bottom:6px">AI Diagnosis</div>
      <p style="font-size:13px;color:#0D1526;margin:0;line-height:1.6">${aiDiagnosis}</p>
    </div>` : ''}
    `}
    <a href="https://app.verploy.com/sites"
       style="display:inline-block;background:${passed ? '#22D98A' : '#080C16'};color:${passed ? '#080C16' : '#fff'};font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">
      ${passed ? 'View site details →' : 'View full report →'}
    </a>
    <hr style="border:none;border-top:1px solid #DDE4F0;margin:24px 0">
    <p style="font-size:11px;color:#A0B0CC;margin:0">Verploy · Verify before you deploy</p>
  </div>
</div>
</body>
</html>`,
  })
}
