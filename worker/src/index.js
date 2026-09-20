/**
 * Verploy Worker — Playwright update testing service
 * Runs on Railway. Polls Supabase for queued update_runs,
 * executes tests, compares screenshots, reports results.
 */

import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { runUpdatePipeline } from './pipeline.js'

const app = express()
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const WORKER_SECRET = process.env.WORKER_SECRET
const POLL_INTERVAL_MS = 30_000  // Check for new jobs every 30s
const MAX_CONCURRENT_JOBS = 3

let activeJobs = 0

// ── Health check endpoint ──
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    active_jobs: activeJobs,
    max_jobs: MAX_CONCURRENT_JOBS,
    timestamp: new Date().toISOString(),
  })
})

// ── Manual trigger endpoint (called from Next.js API) ──
app.post('/run/:runId', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || authHeader !== `Bearer ${WORKER_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { runId } = req.params
  if (!runId) return res.status(400).json({ error: 'Missing runId' })

  // Acknowledge immediately, process in background
  res.json({ ok: true, runId, message: 'Job accepted' })

  processRun(runId).catch(err => {
    console.error(`[worker] Failed to process run ${runId}:`, err)
  })
})

// ── Poll for queued runs ──
async function pollForJobs() {
  if (activeJobs >= MAX_CONCURRENT_JOBS) return

  try {
    const slots = MAX_CONCURRENT_JOBS - activeJobs

    const { data: runs, error } = await supabase
      .from('update_runs')
      .select('id')
      .eq('status', 'queued')
      .is('worker_id', null)
      .order('queued_at', { ascending: true })
      .limit(slots)

    if (error) {
      console.error('[worker] Poll error:', error.message)
      return
    }

    if (runs && runs.length > 0) {
      console.log(`[worker] Found ${runs.length} queued run(s)`)
      for (const run of runs) {
        processRun(run.id).catch(err => {
          console.error(`[worker] Failed to process run ${run.id}:`, err)
        })
      }
    }
  } catch (err) {
    console.error('[worker] Unexpected poll error:', err)
  }
}

async function processRun(runId) {
  // Claim the run atomically
  const workerId = `worker-${process.pid}-${Date.now()}`
  const { data: claimed, error } = await supabase
    .from('update_runs')
    .update({ worker_id: workerId, started_at: new Date().toISOString() })
    .eq('id', runId)
    .eq('status', 'queued')
    .is('worker_id', null)
    .select()
    .single()

  if (error || !claimed) {
    // Already claimed by another worker
    return
  }

  activeJobs++
  console.log(`[worker] Starting run ${runId} (active: ${activeJobs})`)

  try {
    await runUpdatePipeline(supabase, claimed)
  } finally {
    activeJobs--
    console.log(`[worker] Finished run ${runId} (active: ${activeJobs})`)
  }
}

// ── Start ──
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`[worker] Listening on :${PORT}`)
  console.log(`[worker] Polling every ${POLL_INTERVAL_MS / 1000}s`)
  setInterval(pollForJobs, POLL_INTERVAL_MS)
  pollForJobs()  // Run immediately on start
})
