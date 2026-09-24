/**
 * Verploy-worker: voert update-runs uit (PLAN.md §5) en draait elke 5 minuten het
 * monitoringonderhoud. Start: `npm run worker` (na `npm run worker:build`).
 */
import os from 'node:os'
import http from 'node:http'
import { chromium, type Browser } from 'playwright-core'
import { createAdminClient } from '@/lib/supabase/admin'
import { runMaintenance } from '@/lib/monitoring/maintenance'
import { dispatchNotifications } from '@/lib/monitoring/notify'
import { evaluateSites, refreshFeed } from '@/lib/vulnerabilities/feed'
import { env } from '@/lib/env'
import { SiteRejectedError, TransientSiteError } from './site-client'
import { diagnoseRun } from './diagnose'
import { closePdfBrowser, processReport } from './reports'
import {
  DEFAULT_STEP_TIMEOUT_MS, RunFailure, STEP_TIMEOUT_MS, event, failureTransition, loadContext, step,
  type Admin, type Run, type Transition,
} from './run'

const WORKER_ID = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000)
const LEASE_SECONDS = 120
const MAINTENANCE_EVERY_MS = Number(process.env.WORKER_MAINTENANCE_MS ?? 5 * 60_000)
const VULN_EVERY_MS = Number(process.env.WORKER_VULN_MS ?? 60_000)

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), worker: WORKER_ID, msg, ...extra }))

let stopping = false
let browser: Browser | null = null
let currentRun: string | null = null
let lastLoopAt = Date.now()

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  })
  return browser
}

async function advance(admin: Admin, run: Run, t: Transition) {
  const { error } = await admin.rpc('advance_update_run', {
    p_run: run.id, p_worker: WORKER_ID, p_status: t.next,
    p_step_state: (t.state ?? {}) as never,
    p_verdict: t.verdict ?? null,
    p_reason_key: t.reason?.key ?? null,
    p_reason_params: (t.reason?.params ?? {}) as never,
    p_items: (t.items ?? null) as never,
  })
  if (error) throw error
  if (t.next !== 'done') await event({ admin, run }, t.next, 'run.step.started')
  else await event({ admin, run }, 'done', `run.verdict.${t.verdict}`, (t.reason?.params ?? {}) as never, t.verdict === 'deployed' || t.verdict === 'cancelled' ? 'info' : 'warning')
}

async function reload(admin: Admin, id: string): Promise<Run | null> {
  const { data } = await admin.from('update_runs').select('*').eq('id', id).maybeSingle()
  return data
}

function withTimeout<T>(p: Promise<T>, ms: number, ac: AbortController): Promise<T> {
  let timer: NodeJS.Timeout
  return Promise.race([
    p,
    new Promise<T>((_, reject) => { timer = setTimeout(() => { ac.abort(); reject(new TransientSiteError(`step timeout after ${ms} ms`, null)) }, ms) }),
  ]).finally(() => clearTimeout(timer))
}

export async function processRun(admin: Admin, claimed: Run): Promise<void> {
  const runAbort = new AbortController()
  let cancelRequested = claimed.cancel_requested
  const renew = setInterval(() => {
    lastLoopAt = Date.now()
    void admin.rpc('renew_update_run', { p_run: claimed.id, p_worker: WORKER_ID, p_lease_seconds: LEASE_SECONDS }).then(({ data, error }) => {
      if (error) return
      if (data === null) runAbort.abort()   // lease kwijt: een andere worker heeft de run
      else cancelRequested = Boolean(data)
    })
  }, 30_000)

  let run: Run | null = claimed
  try {
    while (run && run.status !== 'done' && !runAbort.signal.aborted) {
      if (stopping) {
        await admin.rpc('release_update_run', { p_run: run.id, p_worker: WORKER_ID, p_delay_seconds: 0 })
        return
      }
      const stepAbort = new AbortController()
      runAbort.signal.addEventListener('abort', () => stepAbort.abort(), { once: true })
      try {
        if (run.attempt > run.max_attempts) {
          throw new RunFailure('run.reason.step_failed', { step: run.status, attempts: run.max_attempts })
        }
        const ctx = await loadContext(admin, run, getBrowser, () => cancelRequested, stepAbort.signal)
        log('step', { run: run.id, status: run.status, attempt: run.attempt })
        const t = await withTimeout(step(ctx), STEP_TIMEOUT_MS[run.status] ?? DEFAULT_STEP_TIMEOUT_MS, stepAbort)
        await advance(admin, run, t)
      } catch (err) {
        if (runAbort.signal.aborted) return
        const message = (err as Error).message?.slice(0, 300) ?? String(err)
        log('step_error', { run: run.id, status: run.status, attempt: run.attempt, error: message })
        const retryable = !(err instanceof RunFailure) && !(err instanceof SiteRejectedError)
        if (retryable && run.attempt < run.max_attempts) {
          await event({ admin, run }, run.status, 'run.retry', { step: run.status, attempt: run.attempt, error: message }, 'warning')
          const locked = err instanceof TransientSiteError && err.status === 409
          await admin.rpc('release_update_run', { p_run: run.id, p_worker: WORKER_ID, p_delay_seconds: locked ? 120 : 20 * run.attempt })
          return
        }
        const reason = err instanceof RunFailure
          ? { key: err.reasonKey, params: err.params }
          : err instanceof SiteRejectedError
            ? { key: 'run.reason.site_rejected', params: { step: run.status, status: err.status, code: err.code ?? '' } }
            : { key: 'run.reason.step_failed', params: { step: run.status, error: message } }
        await event({ admin, run }, run.status, 'run.step.failed', reason.params as never, 'error')
        try {
          await advance(admin, run, failureTransition(run, reason))
        } catch (advErr) {
          log('advance_failed', { run: run.id, error: (advErr as Error).message })
          return
        }
      }
      run = await reload(admin, run.id)
    }
    if (run?.status === 'done') {
      // Eerst de diagnose (die komt mee in de melding en e-mail), dan de uitkomst melden.
      await diagnoseRun(admin, run, { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL, log })
        .catch(e => log('diagnosis_failed', { run: run!.id, error: (e as Error).message }))
      const { error } = await admin.rpc('record_run_outcome', { p_run: run.id })
      if (error) log('outcome_failed', { run: run.id, error: error.message })
      await dispatchNotifications(admin, { limit: 10 }).catch(e => log('notify_failed', { error: (e as Error).message }))
      log('done', { run: run.id, verdict: run.verdict })
    }
  } finally {
    clearInterval(renew)
  }
}

/** Healthcheck voor het platform (Railway): 200 zolang de lus draait. */
function startHealthServer(port: number) {
  http.createServer((req, res) => {
    const stale = Date.now() - lastLoopAt > 30 * 60_000
    res.writeHead(stale ? 503 : 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: !stale, worker: WORKER_ID, run: currentRun }))
  }).listen(port, '0.0.0.0')
}

async function main() {
  const admin = createAdminClient()
  if (process.env.WORKER_HEALTH_PORT || process.env.PORT) startHealthServer(Number(process.env.WORKER_HEALTH_PORT || process.env.PORT))
  log('started', { poll_ms: POLL_MS })
  const stop = () => { stopping = true; log('stopping') }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)

  let lastMaintenance = 0
  let lastVuln = 0
  let feedBusy = false
  while (!stopping) {
    lastLoopAt = Date.now()
    if (Date.now() - lastVuln > VULN_EVERY_MS) {
      lastVuln = Date.now()
      // De feed is groot (minuten): op de achtergrond, zodat updates niet hoeven te wachten.
      if (!feedBusy) {
        feedBusy = true
        refreshFeed(admin, { apiKey: env().WORDFENCE_API_KEY, url: env().WORDFENCE_FEED_URL })
          .then(r => { if (!r.skipped) log(r.error ? 'vuln_feed_failed' : 'vuln_feed', { ...r }) })
          .catch(e => log('vuln_feed_failed', { error: (e as Error).message }))
          .finally(() => { feedBusy = false })
      }
      await evaluateSites(admin)
        .then(r => { if (r.evaluated || r.autofixStarted) log('vuln_evaluated', { ...r }) })
        .catch(e => log('vuln_evaluate_failed', { error: (e as Error).message }))
    }
    if (Date.now() - lastMaintenance > MAINTENANCE_EVERY_MS) {
      lastMaintenance = Date.now()
      await runMaintenance(admin).then(r => log('maintenance', { ...r })).catch(e => log('maintenance_failed', { error: (e as Error).message }))
      await admin.rpc('schedule_monthly_reports').then(({ data, error }) => {
        if (error) log('schedule_reports_failed', { error: error.message })
        else if (data) log('reports_scheduled', { count: data })
      })
    }
    const { data, error } = await admin.rpc('claim_update_run', { p_worker: WORKER_ID, p_lease_seconds: LEASE_SECONDS })
    if (error) {
      log('claim_failed', { error: error.message })
    } else if (data && data.length) {
      currentRun = data[0]!.id
      await processRun(admin, data[0]!).catch(e => log('run_crashed', { error: (e as Error).stack ?? String(e) }))
      currentRun = null
      continue
    }
    // Geen update-run te doen: dan een rapport (updates gaan voor, want die houden een site bezet).
    const rep = await admin.rpc('claim_report', { p_worker: WORKER_ID, p_lease_seconds: 300 })
    if (!rep.error && rep.data && rep.data.length) {
      await processReport(admin, rep.data[0]!, WORKER_ID, log)
      continue
    }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
  await browser?.close().catch(() => undefined)
  await closePdfBrowser()
  log('stopped')
}

if (process.env.VERPLOY_WORKER_NO_MAIN !== '1') {
  main().catch(err => { console.error(err); process.exit(1) })
}
