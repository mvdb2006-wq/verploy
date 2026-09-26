import type { SupabaseClient } from '@supabase/supabase-js'
import type { Browser, BrowserContext } from 'playwright-core'
import type { Database, Json, Tables } from '@/lib/database.types'
import { decryptSecret } from '@/lib/security/secretbox'
import { keyMaterial } from '@/lib/security/keys'
import { SiteClient, SiteRejectedError, TransientSiteError, type Diagnostics, type PackageResult, type PageTarget } from './site-client'
import { capturePage, newContext, type Landmark, type PageCapture, type Viewport } from './checks'
import { comparePage, dynamicMask, firstFailure, healthy, maskCoverage, unionMask, visualDiff, type CheckOutcome, type DynamicMask, type VisualDiff } from './compare'
import { compareFunctional, runFunctional, type FnFailure, type FnResult, type FunctionalTargets } from './functional'
import { explainFailure } from '@/lib/updates/failure'
import { SKIPPED_DEPENDENCY, dependencyOrder, dependentsOf, isolatedFailure, stagingOk, type RunItem } from '@/lib/run-items'

export type Admin = SupabaseClient<Database>
export type Run = Tables<'update_runs'>
export type Status = Run['status']
type Verdict = 'deployed' | 'blocked' | 'rolled_back' | 'error' | 'cancelled'
type Phase = 'production_before' | 'staging_before' | 'staging_after' | 'production_after'

export const BUCKET = 'run-artifacts'
const VIEWPORTS: Viewport[] = ['desktop', 'mobile']

/** Maximale duur per stap (daarna telt het als mislukte poging). */
export const STEP_TIMEOUT_MS: Partial<Record<Status, number>> = {
  staging_create: 20 * 60_000,
  baseline: 10 * 60_000, staging_baseline: 10 * 60_000, staging_test: 10 * 60_000, postcheck: 10 * 60_000,
  deploy_snapshot: 20 * 60_000, deploy_apply: 15 * 60_000, staging_update: 15 * 60_000, rollback: 10 * 60_000,
}
export const DEFAULT_STEP_TIMEOUT_MS = 5 * 60_000

/** Stappen waarin productie al is aangeraakt: bij een fout volgt een rollback. */
const PRODUCTION_TOUCHED: Status[] = ['deploy_apply', 'postcheck']

/** Onderdeel van de run; `package_file` = pakket dat productie ophaalde (betaalde plugins met domeinlicentie). */
type Item = RunItem

interface StepState {
  pages?: PageTarget[]
  staging_url?: string
  staging_pages?: PageTarget[]
  /** Wat functioneel getest wordt (vastgelegd bij de nulmeting op de testkopie; null = connector te oud). */
  functional?: FunctionalTargets | null
  pending_verdict?: Verdict
  pending_reason?: { key: string; params: Record<string, Json> }
  rollback_verified?: boolean
  /** Foutgegevens van de site op het moment dat het misging (voor de diagnose, fase 5). */
  diagnostics?: (Diagnostics & { where: 'staging' | 'production' }) | null
}

export interface Transition {
  next: Status
  state?: StepState
  items?: Item[]
  verdict?: Verdict
  reason?: { key: string; params: Record<string, Json> }
}

export class RunFailure extends Error {
  constructor(readonly reasonKey: string, readonly params: Record<string, Json> = {}) {
    super(reasonKey)
  }
}

export interface RunContext {
  admin: Admin
  run: Run
  site: { id: string; name: string; url: string; agency_id: string; test_paths: string[]; test_masks: string[]; diff_threshold: number }
  client: SiteClient
  browser: () => Promise<Browser>
  cancelled: () => boolean
  signal: AbortSignal
  /** Per onderdeel (type:slug) of het actief is op de site; onbekend = niet in de map. */
  active?: Map<string, boolean>
}

export async function loadContext(admin: Admin, run: Run, browser: () => Promise<Browser>, cancelled: () => boolean, signal: AbortSignal): Promise<RunContext> {
  const { data: site, error } = await admin.from('sites')
    .select('id, name, url, agency_id, test_paths, test_masks, diff_threshold').eq('id', run.site_id).single()
  if (error || !site) throw new RunFailure('run.reason.site_missing')
  const { data: cred } = await admin.from('site_credentials').select('secret_ciphertext').eq('site_id', run.site_id).single()
  if (!cred?.secret_ciphertext) throw new RunFailure('run.reason.not_connected')
  const secret = decryptSecret(cred.secret_ciphertext, keyMaterial())
  const { data: comps } = await admin.from('site_components').select('type, slug, active').eq('site_id', run.site_id)
  const active = new Map((comps ?? []).map(c => [`${c.type}:${c.slug}`, c.active]))
  return { admin, run, site, client: new SiteClient(site.id, secret, run.id), browser, cancelled, signal, active }
}

// ── Opslag ────────────────────────────────────────────────────────────────────

export async function event(ctx: Pick<RunContext, 'admin' | 'run'>, step: string, key: string, params: Record<string, Json> = {}, level: 'info' | 'warning' | 'error' = 'info') {
  const { error } = await ctx.admin.from('update_run_events').insert({ agency_id: ctx.run.agency_id, run_id: ctx.run.id, step, level, message_key: key, params })
  if (error) throw error
}

const safeKey = (key: string) => key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page'
const artifactPath = (ctx: RunContext, phase: Phase, key: string, viewport: Viewport, suffix = '') =>
  `${ctx.run.agency_id}/${ctx.run.id}/${phase}/${safeKey(key)}-${viewport}${suffix}.png`

async function upload(ctx: RunContext, path: string, png: Buffer) {
  const { error } = await ctx.admin.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: true })
  if (error) throw new TransientSiteError(`storage upload: ${error.message}`, null)
}

async function download(ctx: RunContext, path: string): Promise<Buffer | null> {
  const { data, error } = await ctx.admin.storage.from(BUCKET).download(path)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

type Facts = Omit<PageCapture, 'screenshot' | 'url' | 'jsErrors' | 'status' | 'loadMs'>
const factsOf = (c: PageCapture): Facts => ({
  error: c.error, phpError: c.phpError, failedResources: c.failedResources, landmarks: c.landmarks,
  textLength: c.textLength, title: c.title, loginForm: c.loginForm, ...(c.moving !== undefined ? { moving: c.moving } : {}),
  ...(c.themes ? { themes: c.themes } : {}),
})

interface StoredCapture { capture: PageCapture; screenshotPath: string | null }

async function loadPhase(ctx: RunContext, phase: Phase): Promise<Map<string, StoredCapture>> {
  const { data, error } = await ctx.admin.from('test_results')
    .select('page_key, viewport, page_url, http_status, load_ms, js_errors, facts, screenshot_path').eq('run_id', ctx.run.id).eq('phase', phase)
  if (error) throw error
  const out = new Map<string, StoredCapture>()
  for (const r of data ?? []) {
    const f = (r.facts ?? {}) as Partial<Facts>
    out.set(`${r.page_key}|${r.viewport}`, {
      screenshotPath: r.screenshot_path,
      capture: {
        url: r.page_url, status: r.http_status, loadMs: r.load_ms ?? 0, jsErrors: (r.js_errors ?? []) as string[],
        error: f.error ?? null, phpError: f.phpError ?? null, failedResources: f.failedResources ?? [],
        landmarks: (f.landmarks ?? []) as Landmark[], textLength: f.textLength ?? 0, title: f.title ?? '', loginForm: f.loginForm ?? null,
        ...(typeof f.moving === 'number' ? { moving: f.moving } : {}),
        ...(Array.isArray(f.themes) ? { themes: f.themes as string[] } : {}),
        screenshot: null,
      },
    })
  }
  return out
}

// ── Testen ────────────────────────────────────────────────────────────────────

export interface PhaseFailure { page: string; viewport: Viewport; check: CheckOutcome }

/**
 * Test alle pagina's (desktop + mobiel) en de inlogpagina in één fase. Met `compareTo` wordt
 * elke pagina vergeleken met dezelfde pagina in die eerdere fase (inclusief pixelvergelijking).
 */
export async function testPhase(
  ctx: RunContext, phase: Phase, base: string, pages: PageTarget[],
  cookies: { name: string; value: string; url: string }[], compareTo: Phase | null,
): Promise<{ failures: PhaseFailure[]; captures: Map<string, PageCapture> }> {
  const before = compareTo ? await loadPhase(ctx, compareTo) : null
  const visualGate = before ? affectsFrontEnd(items(ctx.run), ctx.active, [...before.values()].flatMap(b => b.capture.themes ?? [])) : true
  const browser = await ctx.browser()
  const failures: PhaseFailure[] = []
  const captures = new Map<string, PageCapture>()
  const targets: (PageTarget & { viewports: Viewport[]; shot: boolean })[] = [
    ...pages.map(p => ({ ...p, viewports: VIEWPORTS, shot: true })),
    { key: 'login', label: 'wp-login.php', url: `${base.replace(/\/$/, '')}/wp-login.php`, viewports: ['desktop'], shot: false },
  ]
  for (const viewport of VIEWPORTS) {
    const context = await newContext(browser, viewport, cookies)
    try {
      for (const t of targets.filter(x => x.viewports.includes(viewport))) {
        if (ctx.signal.aborted) throw new TransientSiteError('aborted', null)
        const prev = before?.get(`${t.key}|${viewport}`)
        const prevPng = prev?.screenshotPath && healthy(prev.capture) ? await download(ctx, prev.screenshotPath) : null
        // Tweede nulmeting (als die er is): wat al tussen twee ladingen vóór de update verschilde (een foto die de
        // ene keer nog niet geladen was, een galerij die anders viel), telt niet als verschil door de update.
        const prevAlt = prevPng && compareTo ? await download(ctx, artifactPath(ctx, compareTo, t.key, viewport, '-alt')) : null
        let baseMask: DynamicMask | null = prevPng && prevAlt ? dynamicMask([prevPng, prevAlt]) : null
        if (baseMask && maskCoverage(baseMask) > MAX_DYNAMIC) baseMask = null
        const opts = { masks: ctx.site.test_masks, cookies, screenshot: t.shot }
        /** Eén meting van de pagina, en (als er een vorige fase is) de vergelijking daarmee. */
        const measure = async () => {
          const cap = await captureSteady(context, t.url, opts, ctx.signal)
          let d: VisualDiff | null = null
          const threshold = Number(ctx.site.diff_threshold)
          if (prev && visualGate && cap.screenshot && prevPng && healthy(cap)) {
            d = visualDiff(prevPng, cap.screenshot, baseMask)
            if (d.ratio > threshold) d = await ignoreDynamic(context, t.url, prevPng, cap.screenshot, d, threshold, opts, baseMask)
          }
          const outcomes = prev ? comparePage(prev.capture, cap, d ? { ratio: d.ratio, threshold, ignored: d.ignored } : null) : []
          return { cap, d, outcomes, passed: prev ? outcomes.every(o => o.ok) : healthy(cap) }
        }
        let m = await measure()
        // Afgekeurd na de update? Eerst nog één keer meten, na een korte pauze. Na een update zijn caches
        // leeg en laadt de eerste keer soms half; een netwerkhapering of een trage afbeelding is geen fout.
        if (prev && !m.passed) {
          await sleep(RECHECK_DELAY_MS, ctx.signal)
          const again = await measure()
          if (again.passed || rank(again.outcomes) > rank(m.outcomes)) m = again
        }
        const cap = m.cap
        captures.set(`${t.key}|${viewport}`, cap)
        let screenshotPath: string | null = null
        let diffPath: string | null = null
        if (cap.screenshot) {
          screenshotPath = artifactPath(ctx, phase, t.key, viewport)
          await upload(ctx, screenshotPath, cap.screenshot)
          // Nulmeting waar later mee vergeleken wordt: nog een keer laden, zodat we weten wat vanzelf verschilt.
          if (!compareTo && (phase === 'staging_before' || phase === 'production_before') && healthy(cap)) {
            const again = await captureSteady(context, t.url, opts, ctx.signal)
            if (again.screenshot && healthy(again)) await upload(ctx, artifactPath(ctx, phase, t.key, viewport, '-alt'), again.screenshot)
          }
        }
        if (m.d) {
          diffPath = artifactPath(ctx, phase, t.key, viewport, '-diff')
          await upload(ctx, diffPath, m.d.diffPng)
        }
        const diffRatio = m.d?.ratio ?? null
        const outcomes: CheckOutcome[] = m.outcomes
        const passed = m.passed
        for (const o of outcomes.filter(x => !x.ok)) failures.push({ page: t.label || t.key, viewport, check: o })
        const { error } = await ctx.admin.from('test_results').upsert({
          agency_id: ctx.run.agency_id, run_id: ctx.run.id, phase, page_key: t.key, page_label: t.label, page_url: t.url,
          viewport, http_status: cap.status, load_ms: cap.loadMs, passed, checks: outcomes as unknown as Json,
          js_errors: cap.jsErrors, facts: factsOf(cap) as unknown as Json,
          screenshot_path: screenshotPath, diff_path: diffPath, diff_ratio: diffRatio,
        }, { onConflict: 'run_id,phase,page_key,viewport' })
        if (error) throw error
      }
    } finally {
      await context.close().catch(() => undefined)
    }
  }
  return { failures, captures }
}

/**
 * Kan deze update de voorkant veranderen? Een niet-actieve plugin of een thema dat de site niet gebruikt
 * (ook niet als parent-thema) wordt niet geladen: een beeldverschil komt dan nooit door de update, dus telt
 * de beeldvergelijking niet mee. De andere controles (bereikbaar, PHP-fouten, inhoud, …) blijven gewoon.
 */
export function affectsFrontEnd(list: { type: string; slug: string }[], active: Map<string, boolean> | undefined, themesInUse: string[]): boolean {
  if (!active) return true
  const used = new Set(themesInUse)
  return list.some(i => {
    if (i.type === 'plugin') return active.get(`plugin:${i.slug}`) !== false
    if (i.type === 'theme') return active.get(`theme:${i.slug}`) !== false || used.has(i.slug) || !themesInUse.length
    return true
  })
}

/** Een run met alleen de Verploy Connector (uitrol van een nieuwe versie). */
const CONNECTOR_SLUG = 'verploy-connector/verploy-connector.php'
const connectorOnly = (run: Run) => items(run).length > 0 && items(run).every(i => i.slug === CONNECTOR_SLUG)

/** Per onderdeel waarom de update niet lukte (voor de melding in de inbox en de ochtendmail). */
const failuresOf = (list: RunItem[]): Json =>
  list.filter(i => i.failure).map(i => ({ name: i.name, slug: i.slug, kind: i.failure!.kind, message: i.failure!.message })) as unknown as Json

/** Pauze voor de tweede meting van een afgekeurde pagina. */
const RECHECK_DELAY_MS = Number(process.env.WORKER_RECHECK_MS ?? 10_000)

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new TransientSiteError('aborted', null))
  const timer = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(new TransientSiteError('aborted', null)) }, { once: true })
})

/** Hoe "goed" een meting is: minder gezakte checks is beter (bij een tweede meting houden we de beste). */
const rank = (outcomes: CheckOutcome[]) => -outcomes.filter(o => !o.ok).length

/** Netwerkhaperingen (verbinding verbroken, time-out) zijn geen oordeel over de site: tot twee keer opnieuw. */
const TRANSIENT = /net::ERR_(CONNECTION_(CLOSED|RESET|REFUSED|ABORTED|TIMED_OUT)|EMPTY_RESPONSE|NETWORK_CHANGED|TIMED_OUT|HTTP2_PROTOCOL_ERROR)|Timeout \d+ms exceeded/i

async function captureSteady(context: BrowserContext, url: string, opts: Parameters<typeof capturePage>[2], signal: AbortSignal): Promise<PageCapture> {
  let cap = await capturePage(context, url, opts)
  for (let i = 0; i < 2 && cap.error && TRANSIENT.test(cap.error); i++) {
    await sleep(5_000 * (i + 1), signal)
    cap = await capturePage(context, url, opts)
  }
  return cap
}

/** Hoogstens zoveel van de pagina mag "vanzelf bewegend" zijn; daarboven vertrouwen we de meting niet. */
const MAX_DYNAMIC = 0.5

/**
 * Het beeld wijkt te veel af. Voordat dat een update tegenhoudt: bewegen die delen ook vanzelf?
 * De pagina wordt (nog steeds ná de update) opnieuw geladen; wat tussen die ladingen al verschilt
 * (slider, achtergrondvideo, wisselende foto's of logo's) telt niet mee. Een echte wijziging door de
 * update blijft bij elke lading hetzelfde en wordt dus nog steeds gezien.
 */
async function ignoreDynamic(
  context: BrowserContext, url: string, beforePng: Buffer, afterPng: Buffer, first: VisualDiff, threshold: number,
  opts: { masks: string[]; cookies: { name: string; value: string; url: string }[] },
  baseMask: DynamicMask | null = null,
): Promise<VisualDiff> {
  const shots = [afterPng]
  let best = first
  for (let i = 0; i < 2; i++) {
    const again = await capturePage(context, url, { masks: opts.masks, cookies: opts.cookies, screenshot: true })
    if (!healthy(again) || !again.screenshot) break
    shots.push(again.screenshot)
    const mask = unionMask(dynamicMask(shots), baseMask)
    if (!mask || maskCoverage(mask) === 0) continue
    if (maskCoverage(mask) > MAX_DYNAMIC) return first
    const d = visualDiff(beforePng, afterPng, mask)
    if (d.ratio < best.ratio) best = d
    if (d.ratio <= threshold) break
  }
  return best
}

function failureReason(failures: PhaseFailure[]): { key: string; params: Record<string, Json> } {
  const first = firstFailure(failures.map(f => f.check))
  const f = failures.find(x => x.check === first) ?? failures[0]!
  return {
    key: `run.reason.check.${f.check.check}`,
    params: { page: f.page, viewport: f.viewport, count: failures.length, ...(f.check.detail ?? {}) } as Record<string, Json>,
  }
}

async function untilReady<T extends { state: string }>(ctx: RunContext, fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 2000; i++) {
    if (ctx.signal.aborted) throw new TransientSiteError('aborted', null)
    const r = await fn()
    if (r.state === 'ready') return r
  }
  throw new TransientSiteError('never ready', null)
}

// ── Stappen ───────────────────────────────────────────────────────────────────

/** Haalt foutgegevens op (fatale fouten, log, omgeving). Mag nooit de run laten mislukken. */
async function collectDiagnostics(ctx: RunContext, base: string, where: 'staging' | 'production'): Promise<StepState['diagnostics']> {
  try {
    const d = await ctx.client.diagnostics(base)
    return {
      where,
      fatals: (d.fatals ?? []).slice(0, 5),
      log_tail: (d.log_tail ?? []).slice(-10),
      environment: { ...d.environment, plugins: (d.environment?.plugins ?? []).slice(0, 80) },
    }
  } catch {
    return null
  }
}

const items = (run: Run) => run.items as unknown as Item[]
const state = (run: Run) => (run.step_state ?? {}) as StepState
const toCleanup = (verdict: Verdict, reason?: { key: string; params: Record<string, Json> }): Transition =>
  ({ next: 'cleanup', state: { pending_verdict: verdict, ...(reason ? { pending_reason: reason } : {}) } })

/** Laat WordPress opnieuw naar plugin- en thema-updates kijken (connector 2.3+; fouten tellen niet). */
async function refreshUpdateLists(ctx: RunContext, base: string): Promise<void> {
  for (const item of [{ type: 'plugin', slug: 'verploy-refresh/verploy-refresh.php' }, { type: 'theme', slug: 'verploy-refresh' }]) {
    await ctx.client.fetchPackage(base, { ...item, to_version: null }).catch(() => undefined)
  }
}

/** Pakket via de live site; een connector ouder dan 2.3 kent dit nog niet (404). */
async function fetchPackage(ctx: RunContext, item: Item): Promise<PackageResult | { ok: false; status: 'connector_outdated' }> {
  try {
    return await ctx.client.fetchPackage(ctx.site.url, { type: item.type, slug: item.slug, to_version: item.to_version })
  } catch (err) {
    if (err instanceof SiteRejectedError && err.status === 404) return { ok: false, status: 'connector_outdated' }
    throw err
  }
}

/**
 * Past de onderdelen één voor één toe. Op de testkopie geldt "fail isolated where possible": weigert de
 * connector een onderdeel zonder er iets aan te veranderen, dan gaan de overige door en worden onderdelen
 * die ervan afhangen overgeslagen. Een crash of een half uitgevoerde update stopt alles (`failed`).
 * Live worden alleen onderdelen toegepast die op de testkopie gelukt en getest zijn.
 */
async function applyAll(ctx: RunContext, base: string, where: 'staging' | 'production'): Promise<{ list: Item[]; failed: Item | null }> {
  const list = items(ctx.run).map(i => ({ ...i }))
  const stepName = where === 'staging' ? 'staging_update' : 'deploy_apply'
  for (const item of dependencyOrder(list)) {
    if (item[where] === 'updated' || item[where] === 'already_current') continue
    if (where === 'staging' && item.staging === SKIPPED_DEPENDENCY) continue
    if (where === 'staging' && item.staging && isolatedFailure(item.staging, item.from_version, null)) continue   // al afgewezen (herhaalde poging)
    if (where === 'production' && !stagingOk(item)) continue
    const payload = () => ({ type: item.type, slug: item.slug, to_version: item.to_version, ...(item.package_file ? { package_file: item.package_file } : {}) })
    let res
    try {
      res = await ctx.client.apply(base, payload())
      // Betaalde plugins/thema's updaten vaak alleen op het eigen (gelicenseerde) domein. Dan haalt de
      // live site het pakket op en installeert de testkopie precies dat bestand (later ook live).
      if (where === 'staging' && res.status === 'no_update_available' && (item.type === 'plugin' || item.type === 'theme') && !item.package_file) {
        const pkg = await fetchPackage(ctx, item)
        if (pkg.ok && pkg.file) {
          item.package_file = pkg.file
          await event(ctx, 'staging_update', 'run.item.package', { name: item.name, version: pkg.version ?? '' })
          res = await ctx.client.apply(base, payload())
        } else {
          res = { ...res, status: pkg.status }
        }
      }
    } catch (err) {
      // Een 500 kan betekenen dat de update wél is geïnstalleerd maar de site daarna crashte.
      // Nogmaals aanroepen is veilig (idempotent) en vertelt ons welke versie er nu staat.
      if (!(err instanceof TransientSiteError)) throw err
      res = await ctx.client.apply(base, payload()).catch(() => null)
      if (!res) {
        // De site reageert niet meer na de update (fatale fout bij het activeren): niet doorgaan.
        item[where] = 'crashed'
        await event(ctx, stepName, 'run.item.crashed', { name: item.name }, 'warning')
        return { list, failed: item }
      }
    }
    item[where] = res.status
    if (!res.ok && res.log) item.failure = explainFailure(res.log)
    await event(ctx, stepName, res.ok ? 'run.item.updated' : 'run.item.failed',
      { name: item.name, from: res.from_version ?? '', to: res.to_version ?? '', status: res.status,
        ...(item.failure && !res.ok ? { kind: item.failure.kind, detail: item.failure.message ?? '' } : {}) }, res.ok ? 'info' : 'warning')
    if (res.ok) continue
    if (where === 'staging' && isolatedFailure(res.status, item.from_version, res.to_version ?? res.from_version)) {
      // Alleen dit onderdeel: de testkopie is er niet door veranderd, de rest wordt gewoon getest.
      await event(ctx, stepName, 'run.item.isolated', { name: item.name })
      for (const dep of dependentsOf(item, list).filter(d => !stagingOk(d) && !d.staging)) {
        dep.staging = SKIPPED_DEPENDENCY
        await event(ctx, stepName, 'run.item.skipped_dependent', { name: dep.name, cause: item.name }, 'warning')
      }
      continue
    }
    return { list, failed: item }
  }
  return { list, failed: null }
}

// ── Functionele tests (formulieren, webwinkel) ──────────────────────────────

/** Doelen voor functionele tests, of null als de connector ze nog niet kent (ouder dan 2.4). */
async function functionalTargets(ctx: RunContext, base: string): Promise<FunctionalTargets | null> {
  try {
    const t = await ctx.client.functional(base)
    return { forms: Array.isArray(t.forms) ? t.forms : [], shop: t.shop ?? null }
  } catch (err) {
    if (err instanceof SiteRejectedError && err.status === 404) return null
    throw err
  }
}

async function functionalPhase(ctx: RunContext, base: string, targets: FunctionalTargets): Promise<FnResult[]> {
  const browser = await ctx.browser()
  // verploy_functional: de testkopie blokkeert dan al het uitgaande verkeer (geen CRM, Zapier, betaalprovider).
  const context = await newContext(browser, 'desktop', [
    { name: 'verploy_staging', value: ctx.client.stagingToken(), url: base },
    { name: 'verploy_functional', value: '1', url: base },
  ])
  let results: FnResult[]
  try {
    results = await runFunctional(context, targets)
  } finally {
    await context.close().catch(() => undefined)
  }
  return results
}

async function storeFunctional(ctx: RunContext, phase: 'staging_before' | 'staging_after', results: FnResult[], failures: FnFailure[] = []) {
  for (const r of results) {
    const failed = failures.filter(f => f.key === r.key)
    const { error } = await ctx.admin.from('test_results').upsert({
      agency_id: ctx.run.agency_id, run_id: ctx.run.id, phase, page_key: `fn:${r.key}`, page_label: r.label, page_url: r.url, viewport: 'desktop',
      http_status: null, load_ms: null, passed: phase === 'staging_before' ? r.outcome !== 'failed' : failed.length === 0,
      checks: failed.map(f => ({ check: f.kind, ok: false, detail: { page: f.label, fnReason: f.reason, ...(f.errors ? { errors: f.errors } : {}) } })) as unknown as Json,
      js_errors: r.jsErrors, facts: { functional: true, kind: r.kind, formKind: r.formKind ?? null, outcome: r.outcome, reason: r.reason } as unknown as Json,
      screenshot_path: null, diff_path: null, diff_ratio: null,
    }, { onConflict: 'run_id,phase,page_key,viewport' })
    if (error) throw error
  }
}

async function loadFunctional(ctx: RunContext, phase: 'staging_before'): Promise<FnResult[]> {
  const { data, error } = await ctx.admin.from('test_results').select('page_key, page_label, page_url, js_errors, facts').eq('run_id', ctx.run.id).eq('phase', phase).like('page_key', 'fn:%')
  if (error) throw error
  return (data ?? []).map(r => {
    const f = (r.facts ?? {}) as { kind?: 'form' | 'shop'; formKind?: FnResult['formKind'] | null; outcome?: FnResult['outcome']; reason?: string }
    return { key: r.page_key.slice(3), kind: f.kind ?? 'form', ...(f.formKind ? { formKind: f.formKind } : {}), label: r.page_label, url: r.page_url,
      outcome: f.outcome ?? 'inconclusive', reason: f.reason ?? '', jsErrors: (r.js_errors ?? []) as string[] }
  })
}

/** Namen van onderdelen die aandacht nodig hebben (niet bijgewerkt of overgeslagen). */
const attentionNames = (list: Item[]) => list.filter(i => i.staging && !stagingOk(i)).map(i => i.name)

export async function step(ctx: RunContext): Promise<Transition> {
  const run = ctx.run
  const st = state(run)
  const prod = ctx.site.url
  const cancelIfAsked = (): Transition | null => (ctx.cancelled() ? toCleanup('cancelled', { key: 'run.reason.cancelled', params: {} }) : null)

  switch (run.status) {
    case 'queued':
      return { next: 'preparing' }

    case 'preparing': {
      try {
        await ctx.client.lock(prod, 7200)
      } catch (err) {
        if (err instanceof SiteRejectedError && err.code === 'verploy_locked') throw new TransientSiteError('site locked by another run', 409)
        if (err instanceof SiteRejectedError && err.status === 404) throw new RunFailure('run.reason.connector_outdated')
        throw err
      }
      const { pages } = await ctx.client.pages(prod, null, ctx.site.test_paths)
      if (!pages.length) throw new RunFailure('run.reason.no_pages')
      await event(ctx, 'preparing', 'run.pages', { count: pages.length, pages: pages.map(p => p.label || p.key) })
      return cancelIfAsked() ?? { next: 'baseline', state: { pages } }
    }

    case 'baseline': {
      const { captures } = await testPhase(ctx, 'production_before', prod, st.pages ?? [], [], null)
      const home = captures.get('home|desktop')
      if ([...captures.values()].every(c => c.error !== null)) throw new RunFailure('run.reason.site_unreachable')
      await event(ctx, 'baseline', 'run.baseline.done', { healthy: [...captures.values()].filter(healthy).length, total: captures.size },
        home && healthy(home) ? 'info' : 'warning')
      return cancelIfAsked() ?? { next: 'staging_create' }
    }

    case 'staging_create': {
      await ctx.client.lock(prod, 7200)
      const r = await untilReady(ctx, () => ctx.client.stagingBuild(prod))
      await event(ctx, 'staging_create', 'run.staging.ready', { files: r.progress?.files_total ?? 0, tables: r.progress?.tables_total ?? 0 })
      return cancelIfAsked() ?? { next: 'staging_baseline', state: { staging_url: r.url } }
    }

    case 'staging_baseline': {
      const url = st.staging_url!
      const { pages } = await ctx.client.pages(url, (st.pages ?? []).map(p => p.key), [])
      const cookies = [{ name: 'verploy_staging', value: ctx.client.stagingToken(), url }]
      const { captures } = await testPhase(ctx, 'staging_before', url, pages, cookies, null)
      const prodBefore = await loadPhase(ctx, 'production_before')
      const prodHome = prodBefore.get('home|desktop')
      const stagingHome = captures.get('home|desktop')
      if (prodHome && healthy(prodHome.capture) && (!stagingHome || !healthy(stagingHome))) {
        throw new RunFailure('run.reason.staging_unusable', { status: stagingHome?.status ?? 0, error: stagingHome?.phpError ?? stagingHome?.error ?? '' })
      }
      // Functionele nulmeting: werken formulieren en webwinkel vóór de update?
      const functional = await functionalTargets(ctx, url)
      if (!functional) await event(ctx, 'staging_baseline', 'run.functional.unsupported')
      else if (functional.forms.length || functional.shop) {
        const res = await functionalPhase(ctx, url, functional)
        await storeFunctional(ctx, 'staging_before', res)
        await event(ctx, 'staging_baseline', 'run.functional.baseline', { forms: functional.forms.length, shop: functional.shop ? 1 : 0, ok: res.filter(r => r.outcome === 'ok').length, total: res.length })
      }
      return cancelIfAsked() ?? { next: 'staging_update', state: { staging_pages: pages, functional } }
    }

    case 'staging_update': {
      const { list, failed } = await applyAll(ctx, st.staging_url!, 'staging')
      if (failed) {
        // De testkopie is door dit onderdeel niet meer betrouwbaar: de rest kan niet los worden bewezen.
        const key = failed.staging === 'crashed' ? 'run.reason.update_crashed' : 'run.reason.update_failed'
        const t = toCleanup('blocked', { key, params: { name: failed.name, status: failed.staging ?? '', total: list.length, attention: [failed.name], failures: failuresOf([failed]) } })
        return { ...t, items: list, state: { ...t.state, diagnostics: await collectDiagnostics(ctx, st.staging_url!, 'staging') } }
      }
      const tested = list.filter(stagingOk)
      if (!tested.length) {
        // Niets bijgewerkt: niets om te testen of live te zetten.
        const first = list.find(i => i.staging !== SKIPPED_DEPENDENCY) ?? list[0]!
        const reason: { key: string; params: Record<string, Json> } = list.length === 1 || attentionNames(list).length === 1
          ? { key: 'run.reason.update_failed', params: { name: first.name, status: first.staging ?? '', total: list.length, attention: attentionNames(list), failures: failuresOf(list) } }
          : { key: 'run.reason.none_updated', params: { count: list.length, attention: attentionNames(list), failures: failuresOf(list) } }
        return { ...toCleanup('blocked', reason), items: list }
      }
      return cancelIfAsked() ?? { next: 'staging_test', items: list }
    }

    case 'staging_test': {
      const url = st.staging_url!
      const cookies = [{ name: 'verploy_staging', value: ctx.client.stagingToken(), url }]
      const { failures } = await testPhase(ctx, 'staging_after', url, st.staging_pages ?? [], cookies, 'staging_before')
      // Functioneel: alleen wat vóór de update werkte, moet erna nog werken.
      let fnFailures: FnFailure[] = []
      if (st.functional && (st.functional.forms.length || st.functional.shop)) {
        const before = await loadFunctional(ctx, 'staging_before')
        const after = await functionalPhase(ctx, url, st.functional)
        fnFailures = compareFunctional(before, after)
        await storeFunctional(ctx, 'staging_after', after, fnFailures)
        await event(ctx, 'staging_test', fnFailures.length ? 'run.functional.failed' : 'run.functional.passed',
          { ok: after.filter(r => r.outcome === 'ok').length, total: after.length, failed: fnFailures.map(f => f.label) }, fnFailures.length ? 'warning' : 'info')
      }
      if (failures.length || fnFailures.length) {
        const tested = items(run).filter(stagingOk)
        const fn = fnFailures[0]
        const base = failures.length ? failureReason(failures)
          : { key: `run.reason.check.${fn!.kind}`, params: { page: fn!.label, fnReason: fn!.reason, count: fnFailures.length } as Record<string, Json> }
        // Meerdere onderdelen samen getest: niet aan te wijzen welke de fout veroorzaakt, dus niets live.
        const reason = { ...base, params: { ...base.params, total: items(run).length, tested: tested.length, attention: tested.map(i => i.name) } }
        await event(ctx, 'staging_test', 'run.staging.failed', reason.params, 'warning')
        const t = toCleanup('blocked', reason)
        return { ...t, state: { ...t.state, diagnostics: await collectDiagnostics(ctx, url, 'staging') } }
      }
      await event(ctx, 'staging_test', 'run.staging.passed')
      return cancelIfAsked() ?? { next: 'deploy_snapshot' }
    }

    case 'deploy_snapshot': {
      await ctx.client.lock(prod, 7200)
      // Alleen de Verploy Connector zelf: geen onderhoudsmelding voor bezoekers (verandert niets aan de voorkant).
      if (!connectorOnly(run)) {
        await ctx.client.maintenance(prod, true, 1800)
        await event(ctx, 'deploy_snapshot', 'run.maintenance.on')
      }
      // Nieuwe nulmeting vlak vóór de update (onder onderhoud): zo telt tussentijds gewijzigde inhoud niet als fout.
      const bypass = [{ name: 'verploy_bypass', value: ctx.client.bypassToken(), url: prod }]
      await testPhase(ctx, 'production_before', prod, st.pages ?? [], bypass, null)
      await untilReady(ctx, () => ctx.client.snapshot(prod, items(run).filter(stagingOk).map(i => ({ type: i.type, slug: i.slug }))))
      await event(ctx, 'deploy_snapshot', 'run.snapshot.ready')
      return { next: 'deploy_apply' }
    }

    case 'deploy_apply': {
      if (!connectorOnly(run)) await ctx.client.maintenance(prod, true, 1800)
      const { list, failed } = await applyAll(ctx, prod, 'production')
      if (failed) {
        return { next: 'rollback', items: list, state: {
          pending_verdict: 'rolled_back',
          pending_reason: { key: 'run.reason.update_failed_production', params: { name: failed.name, status: failed.production ?? '' } },
          diagnostics: await collectDiagnostics(ctx, prod, 'production'),
        } }
      }
      return { next: 'postcheck', items: list }
    }

    case 'postcheck': {
      const bypass = [{ name: 'verploy_bypass', value: ctx.client.bypassToken(), url: prod }]
      const { failures } = await testPhase(ctx, 'production_after', prod, st.pages ?? [], bypass, 'production_before')
      if (failures.length) {
        const reason = failureReason(failures)
        await event(ctx, 'postcheck', 'run.postcheck.failed', reason.params, 'error')
        // Eerst de foutgegevens ophalen (via de noodroute als de site plat ligt), dan pas terugzetten.
        return { next: 'rollback', state: { pending_verdict: 'rolled_back', pending_reason: reason, diagnostics: await collectDiagnostics(ctx, prod, 'production') } }
      }
      await event(ctx, 'postcheck', 'run.postcheck.passed')
      // Gedeeltelijk: de geteste onderdelen staan live, de rest vraagt aandacht (met een eigen melding).
      const attention = attentionNames(items(run))
      if (attention.length) {
        return toCleanup('deployed', { key: 'run.reason.partial', params: {
          deployed: items(run).filter(i => i.production === 'updated' || i.production === 'already_current').length,
          total: items(run).length, attention, statuses: items(run).filter(i => i.staging && !stagingOk(i)).map(i => i.staging!),
          failures: failuresOf(items(run)) } })
      }
      return toCleanup('deployed')
    }

    case 'rollback': {
      await ctx.client.rollback(prod)
      await event(ctx, 'rollback', 'run.rollback.done')
      // Controle: werkt de site weer zoals vóór de update?
      const browser = await ctx.browser()
      const context = await newContext(browser, 'desktop', [{ name: 'verploy_bypass', value: ctx.client.bypassToken(), url: prod }])
      const home = await capturePage(context, prod.replace(/\/?$/, '/'), { masks: [], cookies: [], screenshot: false }).finally(() => context.close())
      if (!healthy(home)) {
        await event(ctx, 'rollback', 'run.rollback.still_broken', { status: home.status ?? 0 }, 'error')
        return toCleanup('error', { key: 'run.reason.rollback_failed', params: { status: home.status ?? 0 } })
      }
      await event(ctx, 'rollback', 'run.rollback.verified')
      return toCleanup(st.pending_verdict ?? 'rolled_back', st.pending_reason)
    }

    case 'cleanup': {
      try {
        await ctx.client.cleanup(prod)
        await event(ctx, 'cleanup', 'run.cleanup.done')
      } catch (err) {
        if (run.attempt < run.max_attempts) throw err
        await event(ctx, 'cleanup', 'run.cleanup.failed', { error: (err as Error).message.slice(0, 200) }, 'warning')
      }
      // WordPress wist na een update zijn lijst met beschikbare updates. Opnieuw laten kijken (via het
      // pakket-eindpunt met een onderdeel dat niet bestaat: alleen de controle, geen download), anders meldt
      // de site "geen updates" tot WordPress zelf weer kijkt. Connector 2.5.4+ doet dit ook zelf.
      await refreshUpdateLists(ctx, prod)
      // Nieuwe heartbeat: het dashboard toont meteen de nieuwe versies.
      await ctx.client.heartbeatNow(prod).catch(() => undefined)
      const verdict = st.pending_verdict ?? 'error'
      return { next: 'done', verdict, reason: st.pending_reason ?? (verdict === 'deployed' ? undefined : { key: 'run.reason.unknown', params: {} }) }
    }

    default:
      throw new Error(`onbekende status ${run.status}`)
  }
}

/** Wat te doen als een stap definitief mislukt (na alle pogingen, of een niet-herstelbare fout). */
export function failureTransition(run: Run, reason: { key: string; params: Record<string, Json> }): Transition {
  const st = state(run)
  if (run.status === 'rollback') return toCleanup('error', { key: 'run.reason.rollback_failed', params: reason.params })
  if (run.status === 'cleanup') return { next: 'done', verdict: st.pending_verdict ?? 'error', reason: st.pending_reason ?? reason }
  if (PRODUCTION_TOUCHED.includes(run.status)) {
    // Productie kan (half) zijn bijgewerkt: terugzetten uit de snapshot.
    return { next: 'rollback', state: { pending_verdict: 'error', pending_reason: reason } }
  }
  return toCleanup('error', reason)
}
