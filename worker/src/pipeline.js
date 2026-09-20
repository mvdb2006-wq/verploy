/**
 * The full update testing pipeline:
 * 1. Mark as staging
 * 2. Apply updates on staging clone
 * 3. Run Playwright UI tests
 * 4. Take before/after screenshots + diff
 * 5. Deploy to production (or roll back)
 * 6. AI diagnosis on failure
 */

import { chromium } from '@playwright/test'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { diagnoseFailure } from './ai.js'
import { uploadScreenshot } from './storage.js'

export async function runUpdatePipeline(supabase, run) {
  const { id: runId, site_id, agency_id, plugin_slugs } = run

  async function updateRun(data) {
    await supabase
      .from('update_runs')
      .update({ ...data })
      .eq('id', runId)
  }

  async function createAlert(severity, type, title, message) {
    await supabase.from('alerts').insert({
      site_id,
      agency_id,
      severity,
      type,
      title,
      message,
    })
  }

  // Get site details
  const { data: site, error: siteError } = await supabase
    .from('sites')
    .select('*')
    .eq('id', site_id)
    .single()

  if (siteError || !site) {
    await updateRun({ status: 'failed', error_message: 'Site not found', finished_at: new Date().toISOString() })
    return
  }

  const stagingUrl = site.staging_url || deriveStagingUrl(site.url)
  await updateRun({ status: 'staging', staged_at: new Date().toISOString(), staging_url: stagingUrl })

  console.log(`[pipeline] Run ${runId}: staging ${plugin_slugs.length} plugin(s) on ${stagingUrl}`)

  // ── Phase 1: Screenshot BEFORE update ──
  let screenshotBeforeUrl = null
  try {
    const beforeBuffer = await takeScreenshot(stagingUrl)
    screenshotBeforeUrl = await uploadScreenshot(supabase, runId, beforeBuffer, 'before')
    await updateRun({ screenshot_before_url: screenshotBeforeUrl })
  } catch (err) {
    console.warn(`[pipeline] Run ${runId}: before-screenshot failed:`, err.message)
  }

  // ── Phase 2: Trigger updates on staging via WP-CLI / REST API ──
  // In production this calls the connector plugin's update endpoint on the staging clone
  // The connector plugin exposes: POST /wp-json/verploy/v1/update with { plugins: [...] }
  let updateSuccess = false
  try {
    const updateRes = await triggerStagingUpdate(stagingUrl, plugin_slugs, site.api_key)
    updateSuccess = updateRes.ok
    if (!updateSuccess) {
      throw new Error(updateRes.error || 'Staging update failed')
    }
    // Wait for WP to settle after updates
    await sleep(5000)
  } catch (err) {
    await updateRun({
      status: 'failed',
      error_message: `Staging update failed: ${err.message}`,
      test_passed: false,
      finished_at: new Date().toISOString(),
    })
    await createAlert('critical', 'update_failed',
      `Update failed on staging for ${site.name}`,
      `Could not apply updates: ${err.message}`
    )
    return
  }

  // ── Phase 3: Playwright UI tests ──
  await updateRun({ status: 'testing', tested_at: new Date().toISOString() })

  let testPassed = false
  let testOutput = ''
  const testScripts = site.test_scripts || []

  try {
    const result = await runPlaywrightTests(stagingUrl, testScripts)
    testPassed = result.passed
    testOutput = result.output
    console.log(`[pipeline] Run ${runId}: tests ${testPassed ? 'PASSED' : 'FAILED'}`)
  } catch (err) {
    testPassed = false
    testOutput = err.message
    console.error(`[pipeline] Run ${runId}: test runner crashed:`, err.message)
  }

  // ── Phase 4: Screenshot AFTER + visual diff ──
  let screenshotAfterUrl = null
  let diffScore = null
  try {
    const afterBuffer = await takeScreenshot(stagingUrl)
    screenshotAfterUrl = await uploadScreenshot(supabase, runId, afterBuffer, 'after')

    if (screenshotBeforeUrl) {
      const beforeBuffer2 = await fetchScreenshotBuffer(supabase, runId, 'before')
      if (beforeBuffer2) {
        diffScore = await computeDiffScore(beforeBuffer2, afterBuffer)
        console.log(`[pipeline] Run ${runId}: visual diff score ${diffScore.toFixed(1)}%`)
      }
    }

    await updateRun({
      screenshot_after_url: screenshotAfterUrl,
      diff_score: diffScore,
    })
  } catch (err) {
    console.warn(`[pipeline] Run ${runId}: screenshot/diff failed:`, err.message)
  }

  // Treat large visual diff as a failure even if tests pass
  const visualDiffFailed = diffScore !== null && diffScore > 5.0  // >5% change = suspicious

  const overallPass = testPassed && !visualDiffFailed

  // ── Phase 5: AI diagnosis on failure ──
  let aiDiagnosis = null
  let aiFixSuggestion = null
  if (!overallPass) {
    try {
      const diagnosis = await diagnoseFailure({
        siteUrl: site.url,
        stagingUrl,
        pluginSlugs: plugin_slugs,
        testOutput,
        diffScore,
      })
      aiDiagnosis = diagnosis.diagnosis
      aiFixSuggestion = diagnosis.fix
    } catch (err) {
      console.warn(`[pipeline] Run ${runId}: AI diagnosis failed:`, err.message)
    }
  }

  // ── Phase 6: Deploy or abort ──
  if (overallPass) {
    // All good — deploy to production
    try {
      await triggerProductionDeploy(site.url, plugin_slugs, site.api_key)
      await updateRun({
        status: 'deployed',
        test_passed: true,
        test_output: testOutput,
        ai_diagnosis: null,
        deployed_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      console.log(`[pipeline] Run ${runId}: DEPLOYED to production ✓`)
    } catch (err) {
      await updateRun({
        status: 'failed',
        test_passed: true,  // tests passed but deploy failed
        test_output: testOutput,
        error_message: `Production deploy failed: ${err.message}`,
        finished_at: new Date().toISOString(),
      })
      await createAlert('critical', 'deploy_failed',
        `Deploy failed for ${site.name}`,
        `Tests passed but production deploy failed: ${err.message}`
      )
    }
  } else {
    // Failed — roll back staging, create alert
    await updateRun({
      status: 'failed',
      test_passed: false,
      test_output: testOutput,
      ai_diagnosis: aiDiagnosis,
      ai_fix_suggestion: aiFixSuggestion,
      finished_at: new Date().toISOString(),
    })

    const alertTitle = visualDiffFailed && !testPassed
      ? `Update failed: tests failed + visual regression detected on ${site.name}`
      : !testPassed
        ? `Update failed: UI tests failed on ${site.name}`
        : `Update failed: visual regression detected on ${site.name}`

    await createAlert('critical', 'update_failed', alertTitle, aiDiagnosis)
    console.log(`[pipeline] Run ${runId}: FAILED — site protected, no production changes made`)
  }
}

// ── Helpers ──

function deriveStagingUrl(url) {
  // e.g. https://client.nl → https://staging.client.nl
  try {
    const u = new URL(url)
    return `https://staging.${u.hostname}`
  } catch {
    return url
  }
}

async function takeScreenshot(url) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
    const buffer = await page.screenshot({ type: 'png', fullPage: false })
    return buffer
  } finally {
    await browser.close()
  }
}

async function runPlaywrightTests(stagingUrl, customScripts = []) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const output = []
  let passed = true

  try {
    const context = await browser.newContext()
    const page = await context.newPage()

    // ── Default tests (run for every site) ──
    const defaultTests = [
      {
        name: 'Homepage loads',
        fn: async () => {
          const res = await page.goto(stagingUrl, { waitUntil: 'networkidle', timeout: 20_000 })
          if (!res || res.status() >= 400) throw new Error(`HTTP ${res?.status()}`)
        },
      },
      {
        name: 'No PHP fatal errors',
        fn: async () => {
          const content = await page.content()
          if (content.includes('Fatal error') || content.includes('Parse error')) {
            throw new Error('PHP fatal error detected in page source')
          }
          if (content.includes('There has been a critical error')) {
            throw new Error('WordPress critical error detected')
          }
        },
      },
      {
        name: 'Navigation is present',
        fn: async () => {
          const nav = await page.$('nav, [role="navigation"], header')
          if (!nav) throw new Error('No navigation element found')
        },
      },
      {
        name: 'No JavaScript console errors',
        fn: async () => {
          const errors = []
          page.on('console', msg => {
            if (msg.type() === 'error') errors.push(msg.text())
          })
          await page.reload({ waitUntil: 'networkidle' })
          if (errors.length > 0) throw new Error(`JS errors: ${errors.slice(0, 3).join('; ')}`)
        },
      },
      {
        name: 'Contact form renders',
        fn: async () => {
          // Try to find and navigate to contact page
          const contactLink = await page.$('a[href*="contact"]')
          if (contactLink) {
            await contactLink.click()
            await page.waitForLoadState('networkidle', { timeout: 10_000 })
            const form = await page.$('form, [class*="contact"]')
            if (!form) throw new Error('Contact page has no form')
          }
          // If no contact link, skip silently
        },
      },
    ]

    for (const test of defaultTests) {
      try {
        await test.fn()
        output.push(`✓ ${test.name}`)
      } catch (err) {
        output.push(`✗ ${test.name}: ${err.message}`)
        passed = false
      }
    }

    // ── Custom test scripts (agency-defined per site) ──
    for (const script of customScripts) {
      try {
        // Custom scripts are stored as { name, steps: [{action, selector, value}] }
        for (const step of script.steps || []) {
          if (step.action === 'goto') await page.goto(stagingUrl + step.value)
          if (step.action === 'click') await page.click(step.selector, { timeout: 10_000 })
          if (step.action === 'fill') await page.fill(step.selector, step.value)
          if (step.action === 'expect_text') {
            const el = await page.$(step.selector)
            if (!el) throw new Error(`Element not found: ${step.selector}`)
            const text = await el.textContent()
            if (!text?.includes(step.value)) throw new Error(`Expected "${step.value}" in element`)
          }
          if (step.action === 'expect_visible') {
            await page.waitForSelector(step.selector, { timeout: 10_000 })
          }
        }
        output.push(`✓ ${script.name}`)
      } catch (err) {
        output.push(`✗ ${script.name}: ${err.message}`)
        passed = false
      }
    }

    await context.close()
  } finally {
    await browser.close()
  }

  return { passed, output: output.join('\n') }
}

async function computeDiffScore(beforeBuffer, afterBuffer) {
  const before = PNG.sync.read(beforeBuffer)
  const after = PNG.sync.read(afterBuffer)

  // Resize to same dimensions if needed
  const width = Math.min(before.width, after.width)
  const height = Math.min(before.height, after.height)
  const diff = new PNG({ width, height })

  const numDiffPixels = pixelmatch(
    before.data, after.data, diff.data,
    width, height,
    { threshold: 0.1 }
  )

  const totalPixels = width * height
  return (numDiffPixels / totalPixels) * 100
}

async function triggerStagingUpdate(stagingUrl, pluginSlugs, apiKey) {
  const res = await fetch(`${stagingUrl}/wp-json/verploy/v1/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Verploy-Key': apiKey,
    },
    body: JSON.stringify({ plugins: pluginSlugs }),
  })

  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status} from staging update endpoint` }
  }

  return res.json()
}

async function triggerProductionDeploy(siteUrl, pluginSlugs, apiKey) {
  const res = await fetch(`${siteUrl}/wp-json/verploy/v1/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Verploy-Key': apiKey,
    },
    body: JSON.stringify({ plugins: pluginSlugs, confirmed: true }),
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from production update endpoint`)
  }
}

async function fetchScreenshotBuffer(supabase, runId, label) {
  try {
    const { data } = await supabase.storage
      .from('screenshots')
      .download(`${runId}/${label}.png`)
    if (!data) return null
    return Buffer.from(await data.arrayBuffer())
  } catch {
    return null
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
