import fs from 'node:fs'
import path from 'node:path'
import puppeteer, { type Browser } from 'puppeteer-core'
import type { Tables } from '@/lib/database.types'
import { createTranslator, isLocale, type Locale } from '@/lib/i18n/core'
import { presentAlert } from '@/lib/monitoring/present'
import { ruleDiagnosis, type Evidence } from '@/lib/diagnosis/rules'
import { computeUptime, type ReportData } from '@/lib/reports/model'
import { footerTemplate, renderReportHtml } from '@/lib/reports/render'
import { renderAgencyEmail, sendEmail } from '@/lib/email'
import type { Admin } from './run'

export type Report = Tables<'reports'>
export const REPORTS_BUCKET = 'reports'
export const BRANDING_BUCKET = 'branding'

const LOGO_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

/** Verzamelt alles voor één rapport. Tijden in UTC; periodegrenzen zijn hele dagen. */
export async function gatherReportData(admin: Admin, report: Report, now = Date.now()): Promise<{ data: ReportData; locale: Locale; agencyEmailReplyTo: string | null }> {
  const locale: Locale = isLocale(report.locale) ? report.locale : 'en'
  const t = createTranslator(locale)
  const [{ data: site }, { data: agency }] = await Promise.all([
    admin.from('sites').select('*').eq('id', report.site_id).single(),
    admin.from('agencies').select('id, name, brand_color, brand_logo_path, report_sender_name').eq('id', report.agency_id).single(),
  ])
  if (!site || !agency) throw new Error('site_or_agency_missing')
  const from = `${report.period_start}T00:00:00Z`
  const until = new Date(Date.parse(`${report.period_end}T00:00:00Z`) + 86_400_000).toISOString()

  const [{ data: snap }, { data: comps }, { data: runs }, { data: offline }, { data: open }, { data: owners }] = await Promise.all([
    admin.from('health_snapshots').select('memory_limit_mb, disk_free_mb').eq('site_id', site.id).order('id', { ascending: false }).limit(1).maybeSingle(),
    admin.from('site_components').select('slug').eq('site_id', site.id).eq('update_available', true),
    admin.from('update_runs').select('id, verdict, items, finished_at').eq('site_id', site.id).eq('status', 'done')
      .in('verdict', ['deployed', 'blocked', 'rolled_back']).gte('finished_at', from).lt('finished_at', until).order('finished_at'),
    admin.from('alerts').select('opened_at, resolved_at, params').eq('site_id', site.id).eq('type', 'site_offline')
      .lt('opened_at', until).or(`resolved_at.is.null,resolved_at.gt.${from}`),
    admin.from('alerts').select('type, severity, params').eq('site_id', site.id).eq('status', 'open').in('severity', ['warning', 'critical']),
    admin.rpc('agency_owner_email', { p_agency: agency.id }),
  ])
  const runIds = (runs ?? []).map(r => r.id)
  const { data: diags } = runIds.length
    ? await admin.from('diagnoses').select('run_id, evidence').in('run_id', runIds)
    : { data: [] as { run_id: string; evidence: unknown }[] }
  const diagByRun = new Map((diags ?? []).map(d => [d.run_id, d.evidence as Evidence]))

  let logoDataUri: string | null = null
  const logoPath = agency.brand_logo_path
  if (logoPath && logoPath.startsWith(`${agency.id}/`)) {
    const ext = logoPath.split('.').pop()?.toLowerCase() ?? ''
    const { data: blob } = await admin.storage.from(BRANDING_BUCKET).download(logoPath)
    if (blob && LOGO_TYPES[ext]) logoDataUri = `data:${LOGO_TYPES[ext]};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`
  }

  const phpAlert = (open ?? []).find(a => a.type === 'php_eol')
  const phpEol = phpAlert ? { date: String((phpAlert.params as { eol?: string }).eol ?? ''), past: phpAlert.severity === 'critical' } : null
  const data: ReportData = {
    agency: { name: agency.name, color: agency.brand_color, logoDataUri, sender: agency.report_sender_name || agency.name },
    site: { name: site.name, url: site.url, client: site.client_name },
    period: { start: report.period_start, end: report.period_end },
    generatedAt: new Date(now).toISOString(),
    uptime: computeUptime((offline ?? []).map(a => ({ opened_at: a.opened_at, resolved_at: a.resolved_at, since: (a.params as { since?: string } | null)?.since ?? null })),
      report.period_start, report.period_end, site.paired_at, now),
    runs: (runs ?? []).map(r => {
      const evidence = diagByRun.get(r.id)
      return {
        date: r.finished_at!,
        verdict: r.verdict as 'deployed' | 'blocked' | 'rolled_back',
        items: (r.items as { name: string; from_version: string | null; to_version: string | null }[]).map(i => ({ name: i.name, from: i.from_version, to: i.to_version })),
        // De diagnose opnieuw opbouwen in de taal van het rapport (de opgeslagen tekst is in de taal van het bureau).
        diagnosis: r.verdict !== 'deployed' && evidence ? ruleDiagnosis(evidence, t, locale).summary : null,
      }
    }),
    health: {
      wp: site.wp_version, php: site.php_version, phpEol: phpEol && phpEol.date ? phpEol : null,
      https: site.url.startsWith('https://'), sslValidUntil: site.ssl_valid ? site.ssl_expires_at : null,
      sslError: site.ssl_valid === false ? site.ssl_error : null, domainUntil: site.domain_expires_at,
      memoryMb: snap?.memory_limit_mb ?? null, diskFreeMb: snap?.disk_free_mb ?? null, pendingUpdates: (comps ?? []).length,
    },
    attention: (open ?? []).filter(a => !a.type.startsWith('update_') && a.type !== 'plugin_updates')
      .map(a => ({ ...presentAlert(t, locale, a), severity: a.severity as 'warning' | 'critical' })),
  }
  return { data, locale, agencyEmailReplyTo: typeof owners === 'string' ? owners : null }
}

let fontCss: string | null = null
function loadFontCss(): string {
  if (fontCss !== null) return fontCss
  try {
    const dir = path.join(process.cwd(), 'node_modules/@fontsource-variable/inter/files')
    const face = (file: string, range: string) =>
      `@font-face{font-family:'Inter Variable';font-style:normal;font-weight:100 900;font-display:block;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(dir, file)).toString('base64')}) format('woff2');unicode-range:${range}}`
    fontCss = face('inter-latin-wght-normal.woff2', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD')
      + face('inter-latin-ext-wght-normal.woff2', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF')
  } catch {
    fontCss = ''   // zonder Inter valt de PDF terug op het systeemlettertype
  }
  return fontCss
}

export async function renderPdf(browser: Browser, data: ReportData, locale: Locale): Promise<Buffer> {
  const t = createTranslator(locale)
  const page = await browser.newPage()
  try {
    // Geen netwerk: alles (logo, lettertype) zit al in de HTML.
    await page.setRequestInterception(true)
    page.on('request', req => { if (req.url().startsWith('data:') || req.url() === 'about:blank') void req.continue(); else void req.abort() })
    await page.setContent(renderReportHtml(data, t, locale, { fontCss: loadFontCss() }), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const pdf = await page.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footerTemplate(data, t, locale),
      margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await page.close().catch(() => undefined)
  }
}

let pdfBrowser: Browser | null = null
/** Puppeteer met dezelfde Chromium als Playwright (in het Playwright-image aanwezig). */
async function getPdfBrowser(): Promise<Browser> {
  if (pdfBrowser?.connected) return pdfBrowser
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_PATH
    || (await import('playwright-core')).chromium.executablePath()
  pdfBrowser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] })
  return pdfBrowser
}

export async function closePdfBrowser() {
  await pdfBrowser?.close().catch(() => undefined)
  pdfBrowser = null
}

const fmtPeriod = (d: ReportData, locale: Locale) => {
  const f = (s: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${s}T12:00:00Z`))
  return `${f(d.period.start)} – ${f(d.period.end)}`
}

/** Maakt één rapport: gegevens → PDF → opslag → (optioneel) e-mail naar de klant. */
export async function processReport(admin: Admin, report: Report, workerId: string, log: (m: string, x?: Record<string, unknown>) => void): Promise<void> {
  try {
    const { data, locale, agencyEmailReplyTo } = await gatherReportData(admin, report)
    const pdf = await renderPdf(await getPdfBrowser(), data, locale)
    const pdfPath = `${report.agency_id}/${report.site_id}/${report.id}.pdf`
    const { error: upErr } = await admin.storage.from(REPORTS_BUCKET).upload(pdfPath, pdf, { contentType: 'application/pdf', upsert: true })
    if (upErr) throw new Error(`storage: ${upErr.message}`)
    let status: 'ready' | 'sent' = 'ready'
    if (report.send_to) {
      const t = createTranslator(locale)
      const vars = { site: data.site.name, period: fmtPeriod(data, locale), agency: data.agency.sender }
      const mail = renderAgencyEmail({ agency: data.agency.sender, color: data.agency.color, heading: t('report.email.heading', vars), body: t('report.email.body', vars), footer: t('report.email.footer', vars) })
      const slug = data.site.name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'site'
      const sent = await sendEmail({
        to: report.send_to, subject: t('report.email.subject', vars), ...mail, fromName: data.agency.sender,
        ...(agencyEmailReplyTo ? { replyTo: agencyEmailReplyTo } : {}),
        attachments: [{ filename: `${t('report.email.filename')}-${slug}-${report.period_start.slice(0, 7)}.pdf`, content: pdf, contentType: 'application/pdf' }],
        idempotencyKey: `report-${report.id}`,
      })
      if (!sent) throw new Error('email_not_sent')
      status = 'sent'
    }
    const { error } = await admin.rpc('complete_report', { p_report: report.id, p_worker: workerId, p_status: status, p_pdf_path: pdfPath, p_pdf_bytes: pdf.length })
    if (error) throw error
    log('report_done', { report: report.id, status, bytes: pdf.length })
  } catch (err) {
    const message = (err as Error).message ?? String(err)
    log('report_failed', { report: report.id, attempt: report.attempt, error: message })
    // Nog pogingen over: terug in de wachtrij; anders definitief mislukt.
    await admin.rpc('complete_report', { p_report: report.id, p_worker: workerId, p_status: report.attempt < 3 ? 'queued' : 'failed', p_error: message })
  }
}
