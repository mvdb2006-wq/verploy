import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { LAB_DIR, LAB_WP, LAB_WP_DIR, clearMails, db, sentMails } from './support/env'
import { addAndPairWordPress, login, signupWithAgency } from './support/flows'

/**
 * Kernflow: de drie scenario's uit de opdracht, tegen een echte WordPress (MySQL) met labplugins:
 *   vp-lab-footer     1.0.0 → 1.1.0  onschuldig             → live gezet
 *   vp-lab-fatal      1.0.0 → 1.1.0  fatale fout            → tegengehouden op staging, niets live
 *   vp-lab-prod-only  1.0.0 → 1.1.0  breekt alleen live     → na livegang teruggedraaid + melding
 * De worker draait mee (playwright.config.ts).
 */
const run = Date.now().toString(36)
const owner = { email: `kern-${run}@example.test`, password: 'correct-horse-battery' }
let siteId = ''

test.describe.configure({ mode: 'serial' })
test.setTimeout(8 * 60_000)

async function footer(): Promise<{ status: number; footer: string | null }> {
  const res = await fetch(`${LAB_WP}/`)
  const html = await res.text()
  return { status: res.status, footer: /footer (v[0-9.]+)/.exec(html)?.[1] ?? null }
}

async function startUpdate(page: Page, plugin: string) {
  await page.goto(`/sites/${siteId}`)
  const boxes = page.getByRole('checkbox')
  for (const box of await boxes.all()) {
    const name = (await box.getAttribute('value')) ?? ''
    if (name.startsWith(`plugin:${plugin}/`)) await box.check()
    else await box.uncheck()
  }
  await page.getByRole('button', { name: '1 update veilig uitvoeren' }).click()
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/runs/[0-9a-f-]{36}`))
  await expect(page.getByRole('heading', { name: 'Veilige update', level: 1 })).toBeVisible()
}

async function waitForVerdict(page: Page, label: string) {
  await expect(page.locator('main').getByText(label, { exact: true }).first()).toBeVisible({ timeout: 6 * 60_000 })
}

test.beforeAll(() => {
  execFileSync('php', [path.resolve(import.meta.dirname, '../../connector-plugin/tests/lab/lab-reset.php'), LAB_WP_DIR, LAB_DIR, LAB_WP,
    path.resolve(import.meta.dirname, '../../connector-plugin/verploy-connector')], { stdio: 'inherit' })
})

// Elke test krijgt een nieuwe browsercontext: na het koppelen opnieuw inloggen.
test.beforeEach(async ({ page }) => {
  if (siteId) await login(page, owner)
})

test('koppelen: labsite toont de drie beschikbare updates', async ({ page, context }) => {
  await signupWithAgency(page, owner, `Kernflow ${run}`)
  siteId = await addAndPairWordPress(page, context, 'Lab-WordPress', LAB_WP)
  await page.reload()
  for (const p of ['vp-lab-footer', 'vp-lab-fatal', 'vp-lab-prod-only']) {
    await expect(page.getByRole('checkbox', { name: new RegExp(`Verploy Lab — ${p}\\b`) })).toBeVisible()
  }
  expect(await footer()).toEqual({ status: 200, footer: 'v1.0.0' })
})

test('scenario 1 — goede update gaat live', async ({ page }) => {
  await startUpdate(page, 'vp-lab-footer')
  const runUrl = page.url()
  // Overzicht toont de lopende update met stap en voortgang.
  await page.goto('/')
  const running = page.getByRole('region', { name: 'Nu bezig' })
  await expect(running.getByRole('link', { name: 'Lab-WordPress' })).toBeVisible()
  await expect(running.getByRole('progressbar', { name: 'Voortgang van de update op Lab-WordPress' })).toBeVisible()
  await page.goto(runUrl)
  await waitForVerdict(page, 'Live gezet')
  await expect(page.getByText('Alle updates staan live en de controle na livegang is geslaagd.')).toBeVisible()
  // tests op staging en productie zijn zichtbaar, met screenshots
  await expect(page.getByRole('heading', { name: 'Tests op de testkopie' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Controle op de live site' })).toBeVisible()
  // geslaagde pagina's staan ingeklapt: open de eerste en controleer dat de screenshot echt laadt
  await page.locator('section[aria-labelledby="prod-title"] summary').first().click()
  const shot = page.locator('section[aria-labelledby="prod-title"] img[alt="Na"]').first()
  await shot.scrollIntoViewIfNeeded()
  await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBeGreaterThan(300)
  expect(await footer()).toEqual({ status: 200, footer: 'v1.1.0' })
  // de nieuwe versie staat direct in het dashboard (heartbeat na afloop)
  await page.goto(`/sites/${siteId}`)
  await expect(page.getByRole('checkbox', { name: /vp-lab-footer/ })).toHaveCount(0)
  await expect(page.getByText('Updategeschiedenis')).toBeVisible()
})

test('scenario 2 — kapotte update wordt tegengehouden, niets live', async ({ page }) => {
  await startUpdate(page, 'vp-lab-fatal')
  await waitForVerdict(page, 'Tegengehouden')
  await expect(page.getByText('Niets live gezet: de update gaf problemen op de testkopie.')).toBeVisible()
  await expect(page.getByText(/WordPress meldt een kritieke fout|PHP geeft een fatale fout|gaf HTTP 500/).first()).toBeVisible()
  // fase 5: diagnose met de schuldige plugin en de ontbrekende functie
  await expect(page.getByRole('heading', { name: 'Diagnose' })).toBeVisible()
  await expect(page.getByText('Verploy Lab — vp-lab-fatal 1.1.0 roept een functie aan die niet bestaat (verploy_lab_function_that_does_not_exist).')).toBeVisible()
  await expect(page.getByText('Zekerheid: hoog')).toBeVisible()
  await expect(page.getByText(/Laat Verploy Lab — vp-lab-fatal voorlopig op versie 1\.0\.0/)).toBeVisible()
  expect((await footer()).status).toBe(200)
  const c = db(); await c.connect()
  try {
    const { rows } = await c.query(`select production from (select jsonb_array_elements(items)->>'production' as production from public.update_runs where site_id = $1 order by created_at desc limit 1) x`, [siteId])
    expect(rows[0].production).toBeNull()   // productie is nooit aangeraakt
  } finally { await c.end() }
  await page.goto('/alerts')
  await expect(page.getByText('Update tegengehouden: Verploy Lab — vp-lab-fatal')).toBeVisible()
})

test('scenario 3 — update die live breekt wordt automatisch teruggedraaid + e-mail', async ({ page }) => {
  await clearMails()
  await startUpdate(page, 'vp-lab-prod-only')
  await waitForVerdict(page, 'Teruggedraaid')
  await expect(page.getByText(/De site is automatisch teruggezet naar de versie van vóór de update/).first()).toBeVisible()
  await expect(page.getByText('Terugdraaien', { exact: true })).toBeVisible()
  await expect(page.getByText('De site werkt weer zoals vóór de update.')).toBeVisible()
  await expect(page.getByText('Verploy Lab — vp-lab-prod-only 1.1.0 roept een functie aan die niet bestaat (verploy_lab_function_that_does_not_exist).')).toBeVisible()
  // live site werkt weer, met de footer-update van scenario 1 nog intact
  expect(await footer()).toEqual({ status: 200, footer: 'v1.1.0' })
  await expect.poll(async () => (await sentMails()).filter(m => m.to.includes(owner.email) && m.subject.includes('Update teruggedraaid')).length, { timeout: 30_000 }).toBe(1)
  const mail = (await sentMails()).find(m => m.subject.includes('Update teruggedraaid'))!
  expect(mail.text).toContain(`/sites/${siteId}/runs/`)
  expect(mail.text).toContain('Diagnose: Verploy Lab — vp-lab-prod-only 1.1.0 roept een functie aan die niet bestaat')
})

test('scenario 4 — betaalde plugin met domeinlicentie: pakket via de live site, getest en live gezet', async ({ page }) => {
  // vp-lab-licensed biedt (zoals Yoast Premium, Avada, ACF Pro) alleen een update aan op het eigen domein, niet op de testkopie.
  await startUpdate(page, 'vp-lab-licensed')
  await waitForVerdict(page, 'Live gezet')
  await expect(page.getByText('Verploy Lab — vp-lab-licensed: updatebestand 1.1.0 opgehaald via de live site (licentie van het eigen domein).')).toBeVisible()
  const html = await (await fetch(`${LAB_WP}/`)).text()
  expect(html).toContain('licensed v1.1.0')
})
