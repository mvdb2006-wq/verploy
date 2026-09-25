import { DATE_LOCALE_TAG, type Locale, type MessageKey, type Translate } from '@/lib/i18n/core'
import type { ReportData } from './model'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function fmtDate(iso: string, locale: Locale): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso)
  return new Intl.DateTimeFormat(DATE_LOCALE_TAG[locale], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' }).format(d)
}
function fmtDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(DATE_LOCALE_TAG[locale], { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }).format(new Date(iso))
}
function fmtNumber(n: number, locale: Locale, digits = 0): string {
  return new Intl.NumberFormat(DATE_LOCALE_TAG[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)
}

/** Donkere of lichte tekst op de merkkleur, afhankelijk van de helderheid. */
function onColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  return lum > 0.55 ? '#0B1220' : '#FFFFFF'
}

export function duration(minutes: number, t: Translate): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? t('report.durationHm', { h, m }) : t('report.durationM', { m })
}

/** Is de periode precies één kalendermaand? Dan heet hij bij naam ("In augustus …"). */
function monthName(d: ReportData, locale: Locale): string | null {
  const [y, m, day] = d.period.start.split('-').map(Number) as [number, number, number]
  if (day !== 1) return null
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  if (d.period.end !== last) return null
  return new Intl.DateTimeFormat(DATE_LOCALE_TAG[locale], { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)))
}

/**
 * De samenvatting in één zin, bovenaan het rapport en in de e-mail:
 * "In augustus hielden we 34 updates veilig bij, losten we 3 beveiligingslekken op en was de website 99,98% online."
 */
export function reportSummary(d: ReportData, t: Translate, locale: Locale): string {
  const updates = d.runs.filter(r => r.verdict === 'deployed').reduce((n, r) => n + r.items.length, 0)
  const fixed = (d.security?.fixed ?? []).reduce((n, v) => n + v.count, 0)
  const caught = d.runs.filter(r => r.verdict !== 'deployed').length
  const clauses: string[] = []
  if (updates) clauses.push(t('report.summary.updates', { count: updates }))
  if (fixed) clauses.push(t('report.summary.fixed', { count: fixed }))
  if (caught) clauses.push(t('report.summary.caught', { count: caught }))
  if (d.uptime.percent !== null) clauses.push(t('report.summary.uptime', { percent: `${fmtNumber(d.uptime.percent, locale, d.uptime.percent === 100 ? 0 : 2)}%` }))
  const month = monthName(d, locale)
  const lead = month ? t('report.summary.leadMonth', { month }) : t('report.summary.leadPeriod')
  if (!clauses.length) return t('report.summary.quiet', { lead })
  const list = new Intl.ListFormat(DATE_LOCALE_TAG[locale], { style: 'long', type: 'conjunction' }).format(clauses)
  return t('report.summary.sentence', { lead, list })
}

/**
 * Het rapport als zelfstandige HTML (voor Puppeteer → PDF). White-label: alleen de naam, het logo
 * en de kleur van het bureau; geen Verploy-branding.
 */
export function renderReportHtml(d: ReportData, t: Translate, locale: Locale, opts: { fontCss?: string } = {}): string {
  const color = /^#[0-9A-Fa-f]{6}$/.test(d.agency.color) ? d.agency.color : '#22D98A'
  const period = t('report.period', { start: fmtDate(d.period.start, locale), end: fmtDate(d.period.end, locale) })
  const deployedItems = d.runs.filter(r => r.verdict === 'deployed').reduce((n, r) => n + r.items.length, 0)
  const stopped = d.runs.filter(r => r.verdict !== 'deployed').length
  const fixedVulns = d.security?.fixed ?? []
  const fixedCount = fixedVulns.reduce((n, v) => n + v.count, 0)
  const kpis = [
    { label: t('report.kpi.uptime'), value: d.uptime.percent === null ? '—' : `${fmtNumber(d.uptime.percent, locale, d.uptime.percent === 100 ? 0 : 2)}%`, note: t('report.kpi.uptimeNote') },
    { label: t('report.kpi.updates'), value: fmtNumber(deployedItems, locale), note: t('report.kpi.updatesNote') },
    { label: t('report.kpi.fixed'), value: fmtNumber(fixedCount, locale), note: t('report.kpi.fixedNote') },
    { label: t('report.kpi.stopped'), value: fmtNumber(stopped, locale), note: t('report.kpi.stoppedNote') },
  ]
  const h = d.health
  const healthRows: [string, string, 'ok' | 'warn' | 'bad' | 'none'][] = [
    [t('report.health.wordpress'), h.wp ?? t('report.health.unknown'), h.wp ? 'ok' : 'none'],
    [t('report.health.php'), h.php ? (h.phpEol ? t(h.phpEol.past ? 'report.health.phpEolPast' : 'report.health.phpEolSoon', { version: h.php, date: fmtDate(h.phpEol.date, locale) }) : h.php) : t('report.health.unknown'),
      !h.php ? 'none' : h.phpEol ? (h.phpEol.past ? 'bad' : 'warn') : 'ok'],
    [t('report.health.ssl'), !h.https ? t('report.health.noHttps') : h.sslError ? t(`alerts.sslError.${h.sslError}` as MessageKey) : h.sslValidUntil ? t('report.health.sslUntil', { date: fmtDate(h.sslValidUntil, locale) }) : t('report.health.unknown'),
      !h.https || h.sslError ? 'bad' : h.sslValidUntil ? 'ok' : 'none'],
    [t('report.health.domain'), h.domainUntil ? t('report.health.domainUntil', { date: fmtDate(h.domainUntil, locale) }) : t('report.health.unknown'), h.domainUntil ? 'ok' : 'none'],
    [t('report.health.memory'), h.memoryMb ? `${fmtNumber(h.memoryMb, locale)} MB` : t('report.health.unknown'), !h.memoryMb ? 'none' : h.memoryMb < 128 ? 'warn' : 'ok'],
    [t('report.health.disk'), h.diskFreeMb !== null ? `${fmtNumber(h.diskFreeMb / 1024, locale, 1)} GB` : t('report.health.unknown'), h.diskFreeMb === null ? 'none' : h.diskFreeMb < 1024 ? 'warn' : 'ok'],
    [t('report.health.pending'), h.pendingUpdates ? t('report.health.pendingCount', { count: h.pendingUpdates }) : t('report.health.pendingNone'), h.pendingUpdates ? 'warn' : 'ok'],
  ]
  const verdictLabel = (v: string) => t(`report.result.${v}` as MessageKey)

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>${esc(t('report.title'))} — ${esc(d.site.name)}</title>
<style>
${opts.fontCss ?? ''}
@page { size: A4; margin: 18mm 16mm 20mm; }
:root { --brand: ${color}; --on-brand: ${onColor(color)}; --ink: #0B1220; --muted: #5B6478; --line: #E3E7EF; --soft: #F5F7FB; --ok: #12805C; --warn: #B45309; --bad: #B91C1C; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: var(--ink); font: 10pt/1.5 'Inter Variable', 'Inter', system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1, h2, h3 { margin: 0; line-height: 1.2; }
.masthead { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 14px; border-bottom: 3px solid var(--brand); }
.brand { display: flex; align-items: center; gap: 12px; }
.brand img { max-height: 44px; max-width: 180px; object-fit: contain; }
.brand .name { font-weight: 700; font-size: 12pt; }
.doc { text-align: right; color: var(--muted); font-size: 9pt; }
.doc strong { display: block; color: var(--ink); font-size: 11pt; }
.title { margin: 22px 0 4px; font-size: 20pt; font-weight: 800; letter-spacing: -0.01em; }
.subtitle { color: var(--muted); margin-bottom: 18px; }
.subtitle a { color: inherit; text-decoration: none; }
.summary { font-size: 12pt; line-height: 1.45; font-weight: 600; margin: 0 0 16px; max-width: 150mm; text-wrap: balance; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 22px; }
.kpi { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; break-inside: avoid; }
.kpi .v { font-size: 17pt; font-weight: 800; font-variant-numeric: tabular-nums; }
.kpi .l { font-size: 8.5pt; font-weight: 600; }
.kpi .n { font-size: 7.5pt; color: var(--muted); }
.kpi:first-child { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
.kpi:first-child .n { color: inherit; opacity: .8; }
section { margin-bottom: 20px; }
section.keep { break-inside: avoid; }
h2 { break-after: avoid; }
section h2 { font-size: 12pt; font-weight: 700; margin-bottom: 4px; }
section .intro { color: var(--muted); font-size: 9pt; margin: 0 0 8px; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; }
th { text-align: left; font-weight: 600; color: var(--muted); font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid var(--line); padding: 6px 8px 5px 0; }
td { border-bottom: 1px solid var(--line); padding: 7px 8px 7px 0; vertical-align: top; }
tr { break-inside: avoid; }
.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.mono { font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; font-size: 8.5pt; }
.pill { display: inline-block; border-radius: 99px; padding: 1px 8px; font-size: 8pt; font-weight: 600; white-space: nowrap; }
.pill.deployed, .pill.ok { background: #E7F6EF; color: var(--ok); }
.pill.blocked, .pill.warn { background: #FEF3E2; color: var(--warn); }
.pill.rolled_back, .pill.bad { background: #FDECEC; color: var(--bad); }
.pill.none { background: var(--soft); color: var(--muted); }
.note { color: var(--muted); font-size: 8.5pt; margin-top: 2px; }
.empty { color: var(--muted); font-style: italic; margin: 4px 0 0; }
.attention { border-left: 3px solid var(--warn); padding: 4px 0 4px 10px; margin-bottom: 8px; break-inside: avoid; }
.attention.critical { border-color: var(--bad); }
.attention strong { display: block; }
.health td:first-child { width: 34%; color: var(--muted); }
</style>
</head>
<body>
<header class="masthead">
  <div class="brand">
    ${d.agency.logoDataUri ? `<img src="${d.agency.logoDataUri}" alt="${esc(d.agency.name)}">` : `<span class="name">${esc(d.agency.name)}</span>`}
  </div>
  <div class="doc"><strong>${esc(t('report.title'))}</strong>${esc(period)}</div>
</header>

<h1 class="title">${esc(d.site.name)}</h1>
<p class="subtitle"><a href="${esc(d.site.url)}">${esc(d.site.url.replace(/^https?:\/\//, ''))}</a>${d.site.client ? ` · ${esc(t('report.client'))}: ${esc(d.site.client)}` : ''}</p>

<p class="summary">${esc(reportSummary(d, t, locale))}</p>

<div class="kpis">
  ${kpis.map(k => `<div class="kpi"><div class="l">${esc(k.label)}</div><div class="v">${esc(k.value)}</div><div class="n">${esc(k.note)}</div></div>`).join('')}
</div>

<section>
  <h2>${esc(t('report.updates.title'))}</h2>
  <p class="intro">${esc(t('report.updates.intro'))}</p>
  ${d.runs.length === 0 ? `<p class="empty">${esc(t('report.updates.none'))}</p>` : `
  <table>
    <thead><tr><th>${esc(t('report.updates.date'))}</th><th>${esc(t('report.updates.component'))}</th><th>${esc(t('report.updates.version'))}</th><th>${esc(t('report.updates.result'))}</th></tr></thead>
    <tbody>
      ${d.runs.map(r => r.items.map((i, idx) => `<tr>
        <td class="num">${idx === 0 ? esc(fmtDate(r.date, locale)) : ''}</td>
        <td>${esc(i.name)}${idx === r.items.length - 1 && r.diagnosis ? `<div class="note">${esc(r.diagnosis)}</div>` : ''}</td>
        <td class="mono">${esc(i.from ?? '—')} → ${esc(i.to ?? '—')}</td>
        <td>${idx === 0 ? `<span class="pill ${r.verdict}">${esc(verdictLabel(r.verdict))}</span>` : ''}</td>
      </tr>`).join('')).join('')}
    </tbody>
  </table>`}
</section>

<section class="keep">
  <h2>${esc(t('report.security.title'))}</h2>
  <p class="intro">${esc(t('report.security.intro'))}</p>
  ${fixedVulns.length === 0 ? `<p class="empty">${esc(t('report.security.none'))}</p>` : `
  <table>
    <thead><tr><th>${esc(t('report.updates.component'))}</th><th>${esc(t('report.security.count'))}</th><th>${esc(t('report.security.severity'))}</th><th>${esc(t('report.security.fixedIn'))}</th><th>${esc(t('report.updates.date'))}</th></tr></thead>
    <tbody>
      ${fixedVulns.map(v => `<tr>
        <td>${esc(v.name)}</td>
        <td class="num">${esc(fmtNumber(v.count, locale))}</td>
        <td><span class="pill ${v.severity === 'critical' || v.severity === 'high' ? 'bad' : 'warn'}">${esc(t(`security.severity.${v.severity}` as MessageKey))}</span></td>
        <td class="mono">${esc(v.version ?? '—')}</td>
        <td class="num">${esc(fmtDate(v.date, locale))}</td>
      </tr>`).join('')}
    </tbody>
  </table>`}
</section>

<section class="keep">
  <h2>${esc(t('report.health.title'))}</h2>
  <p class="intro">${esc(t('report.health.intro'))}</p>
  <table class="health"><tbody>
    ${healthRows.map(([l, v, tone]) => `<tr><td>${esc(l)}</td><td><span class="pill ${tone}">${esc(v)}</span></td></tr>`).join('')}
  </tbody></table>
</section>

<section class="keep">
  <h2>${esc(t('report.attention.title'))}</h2>
  ${d.attention.length === 0 ? `<p class="empty">${esc(t('report.attention.none'))}</p>` :
    d.attention.map(a => `<div class="attention ${a.severity}"><strong>${esc(a.title)}</strong>${esc(a.body)}</div>`).join('')}
</section>

<section class="keep">
  <h2>${esc(t('report.downtime.title'))}</h2>
  ${d.uptime.incidents.length === 0 ? `<p class="empty">${esc(t('report.downtime.none'))}</p>` : `
  <table><thead><tr><th>${esc(t('report.downtime.start'))}</th><th>${esc(t('report.downtime.duration'))}</th></tr></thead><tbody>
    ${d.uptime.incidents.map(i => `<tr><td class="num">${esc(fmtDateTime(i.start, locale))}</td><td class="num">${esc(i.minutes === null ? t('report.downtime.ongoing') : duration(i.minutes, t))}</td></tr>`).join('')}
  </tbody></table>`}
</section>
</body>
</html>`
}

/** Voettekst voor Puppeteer (paginanummers). Puppeteer vult .pageNumber en .totalPages zelf in. */
export function footerTemplate(d: ReportData, t: Translate, locale: Locale): string {
  const page = esc(t('report.page', { page: '§P§', total: '§T§' })).replace('§P§', '<span class="pageNumber"></span>').replace('§T§', '<span class="totalPages"></span>')
  const left = esc(t('report.preparedBy', { agency: d.agency.sender, date: fmtDate(d.generatedAt, locale) }))
  return `<div style="width:100%;font:7.5pt system-ui,sans-serif;color:#5B6478;padding:0 16mm;display:flex;justify-content:space-between"><span>${left}</span><span>${page}</span></div>`
}
