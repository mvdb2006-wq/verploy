import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { LAB_DIR, LAB_WP, LAB_WP_DIR, db } from './support/env'
import { addAndPairWordPress, login, signupWithAgency } from './support/flows'

/**
 * Bekende kwetsbaarheden (Wordfence-feed = lokale mock met hetzelfde formaat), tegen de lab-WordPress:
 * vp-lab-footer 1.0.0 heeft een "ernstig" lek dat in 1.1.0 is opgelost.
 *  1. standaard: melding + "Veilig oplossen" klaar, er gebeurt niets zonder toestemming
 *  2. bureau zet "direct automatisch oplossen" aan → Verploy start zelf een veilige update → live → lek weg
 */
const run = Date.now().toString(36)
const owner = { email: `lek-${run}@example.test`, password: 'correct-horse-battery' }
let siteId = ''

test.describe.configure({ mode: 'serial' })
test.setTimeout(8 * 60_000)

test.beforeAll(() => {
  execFileSync('php', [path.resolve(import.meta.dirname, '../../connector-plugin/tests/lab/lab-reset.php'), LAB_WP_DIR, LAB_DIR, LAB_WP,
    path.resolve(import.meta.dirname, '../../connector-plugin/verploy-connector')], { stdio: 'inherit' })
})

test.beforeEach(async ({ page }) => {
  if (siteId) await login(page, owner)
})

async function runsFor(site: string) {
  const c = db(); await c.connect()
  try {
    const { rows } = await c.query(`select id, trigger, created_by from public.update_runs where site_id = $1 order by created_at`, [site])
    return rows as Array<{ id: string; trigger: string; created_by: string | null }>
  } finally { await c.end() }
}

test('lek gevonden: melding, uitleg met bron, en de oplossing staat klaar — zonder toestemming gebeurt er niets', async ({ page, context }) => {
  await signupWithAgency(page, owner, `Lekken ${run}`)
  siteId = await addAndPairWordPress(page, context, 'Lab-WordPress', LAB_WP)

  const security = page.getByRole('region', { name: 'Beveiliging' })
  await expect.poll(async () => { await page.reload(); return security.getByText('1 bekend lek in 1 onderdeel').isVisible() }, { timeout: 60_000 }).toBe(true)
  await expect(security.getByText('Verploy Lab — vp-lab-footer', { exact: true })).toBeVisible()
  await expect(security.getByText(/1\.0\.0 · opgelost in 1\.1\.0/)).toBeVisible()
  await expect(security.getByText('Ernstig', { exact: true })).toBeVisible()
  await expect(security.getByRole('link', { name: /Unauthenticated Stored Cross-Site Scripting/ })).toHaveAttribute('href', 'https://www.wordfence.com/threat-intel/vulnerabilities/id/e2e-1')
  await expect(security.getByText('CVE-2026-99001 · CVSS 7.2')).toBeVisible()
  // oud lek (≤ 0.9) en informatieve records tellen niet mee
  await expect(security.getByText(/Oude lek|Informatief/)).toHaveCount(0)
  // standaard: toestemming vragen
  await expect(security.getByText(/Verploy lost niets op zonder jouw toestemming/)).toBeVisible()
  await expect(security.getByRole('button', { name: 'Veilig oplossen' })).toBeVisible()
  // bronvermelding (Wordfence/Defiant en MITRE) is aanwezig
  await expect(security.getByText('Bron: Wordfence Intelligence (Defiant Inc.).')).toBeVisible()
  await security.getByText('Copyright en licentie').click()
  await expect(security.getByText(/Copyright 2012-2026 Defiant Inc\./)).toBeVisible()
  await expect(security.getByText(/Copyright 1999-2026 The MITRE Corporation/)).toBeVisible()

  await page.goto('/alerts')
  await expect(page.getByText('Bekend beveiligingslek: Verploy Lab — vp-lab-footer')).toBeVisible()
  await expect(page.getByText('Ernst: Ernstig. Bekijk de site in Verploy en voer de oplossing veilig uit.')).toBeVisible()

  // Een paar evaluatierondes later is er nog steeds geen update gestart.
  await page.waitForTimeout(6_000)
  expect(await runsFor(siteId)).toEqual([])
})

test('"direct automatisch oplossen" aan → Verploy start zelf een veilige update, zet hem live en het lek verdwijnt', async ({ page }) => {
  await page.goto('/settings')
  const form = page.getByRole('form', { name: 'Beveiligingslekken' })
  await form.getByLabel(/Direct automatisch oplossen/).check()
  await form.getByRole('button', { name: 'Opslaan' }).click()
  await expect(form.getByText('Opgeslagen.')).toBeVisible()

  // De worker start de run zelf (trigger security, geen gebruiker).
  await expect.poll(async () => (await runsFor(siteId)).length, { timeout: 60_000 }).toBe(1)
  const [r] = await runsFor(siteId)
  expect(r).toMatchObject({ trigger: 'security', created_by: null })

  await page.goto(`/sites/${siteId}/runs/${r!.id}`)
  await expect(page.getByText('Automatisch gestart door Verploy vanwege een bekend beveiligingslek.')).toBeVisible()
  await expect(page.locator('main').getByText('Live gezet', { exact: true }).first()).toBeVisible({ timeout: 6 * 60_000 })

  // Na de update (nieuwe heartbeat) is het lek opgelost en de melding weg.
  await page.goto(`/sites/${siteId}`)
  const security = page.getByRole('region', { name: 'Beveiliging' })
  await expect.poll(async () => { await page.reload(); return security.getByText('Geen bekende lekken in WordPress, plugins en thema’s.').isVisible() }, { timeout: 60_000 }).toBe(true)
  await page.goto('/alerts')
  await expect(page.getByText('Bekend beveiligingslek: Verploy Lab — vp-lab-footer')).toHaveCount(0)
  // Er wordt niet nog een keer iets gestart.
  expect(await runsFor(siteId)).toHaveLength(1)
})
