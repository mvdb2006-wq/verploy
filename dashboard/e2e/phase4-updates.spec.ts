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

/** Start één veilige update met precies deze labplugins aangevinkt. */
async function startUpdates(page: Page, plugins: string[]) {
  await page.goto(`/sites/${siteId}`)
  for (const box of await page.getByRole('checkbox').all()) {
    const name = (await box.getAttribute('value')) ?? ''
    if (plugins.some(p => name.startsWith(`plugin:${p}/`))) await box.check()
    else await box.uncheck()
  }
  await page.getByRole('button', { name: `${plugins.length} updates veilig uitvoeren` }).click()
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/runs/[0-9a-f-]{36}`))
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
  await expect(page.getByRole('heading', { name: 'Update veilig uitgevoerd' })).toBeVisible()
  await expect(page.getByText('Je live site werkt normaal: de controle na livegang is geslaagd.')).toBeVisible()
  await expect(page.getByText('Je hoeft niets te doen.')).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'Niets live gezet' })).toBeVisible()
  await expect(page.getByText('Je live site is niet gewijzigd.')).toBeVisible()
  // Connector 2.5: "Naar WP Admin" logt met één klik in (formulier naar Verploy).
  await expect(page.getByRole('button', { name: 'Naar WP Admin' }).locator('xpath=ancestor::form')).toHaveAttribute('action', /\/sites\/[0-9a-f-]{36}\/wp-admin$/)
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
  await expect(page.getByRole('heading', { name: 'Update teruggedraaid' })).toBeVisible()
  await expect(page.getByText('Je live site is teruggezet naar de toestand van vóór de update.')).toBeVisible()
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

test('scenario 5 — één update zonder pakket: apart gezet, afhankelijke overgeslagen, de rest wél live', async ({ page }) => {
  // Zoals WPBakery zonder geldige licentie: WordPress biedt de update aan, maar het pakket is er niet.
  await clearMails()
  await startUpdates(page, ['vp-lab-nopkg', 'vp-lab-nopkg-addon', 'vp-lab-extra'])
  await waitForVerdict(page, 'Deels live')
  await expect(page.getByRole('heading', { name: '1 van 3 updates veilig uitgevoerd' })).toBeVisible()
  await expect(page.getByText('Getest en live gezet: Verploy Lab — vp-lab-extra.')).toBeVisible()
  await expect(page.getByText('Verploy Lab — vp-lab-nopkg: Update mislukt. De live versie is niet gewijzigd.')).toBeVisible()
  await expect(page.getByText(/Overgeslagen omdat het afhangt van een onderdeel dat niet lukte: Verploy Lab — vp-lab-nopkg-addon\./)).toBeVisible()
  await expect(page.getByText('Je live site werkt normaal: de controle na livegang is geslaagd.')).toBeVisible()
  await expect(page.getByText('Aanbevolen', { exact: true })).toBeVisible()
  await expect(page.getByText('vp-lab-nopkg-addon overgeslagen: hangt af van Verploy Lab — vp-lab-nopkg.', { exact: false })).toBeVisible()
  // per onderdeel een eigen uitkomst
  const rows = page.getByRole('row')
  await expect(rows.filter({ hasText: 'vp-lab-extra' }).getByText('Live', { exact: true })).toBeVisible()
  await expect(page.getByText('Vraagt aandacht', { exact: true })).toBeVisible()
  await expect(page.getByText('Overgeslagen', { exact: true })).toBeVisible()
  // live: extra bijgewerkt, nopkg en addon ongewijzigd
  const html = await (await fetch(`${LAB_WP}/`)).text()
  expect(html).toContain('extra v1.1.0')
  const c = db(); await c.connect()
  try {
    const { rows: its } = await c.query(`select i->>'slug' slug, i->>'staging' staging, i->>'production' production
      from public.update_runs r, jsonb_array_elements(r.items) i where r.site_id = $1 and r.created_at = (select max(created_at) from public.update_runs where site_id = $1) order by 1`, [siteId])
    expect(its).toEqual([
      { slug: 'vp-lab-extra/vp-lab-extra.php', staging: 'updated', production: 'updated' },
      { slug: 'vp-lab-nopkg-addon/vp-lab-nopkg-addon.php', staging: 'skipped_dependency', production: null },
      { slug: 'vp-lab-nopkg/vp-lab-nopkg.php', staging: 'update_failed', production: null },
    ])
  } finally { await c.end() }
  // Inbox: één melding met alleen wat aandacht vraagt, plus een e-mail.
  await page.goto('/inbox')
  await expect(page.getByText('Update vraagt aandacht: Verploy Lab — vp-lab-nopkg, Verploy Lab — vp-lab-nopkg-addon')).toBeVisible()
  await expect(page.getByText(/1 van 3 updates zijn getest en live gezet; je site werkt normaal\./)).toBeVisible()
  await page.getByRole('link', { name: 'Update bekijken' }).click()
  await expect(page.getByRole('heading', { name: '1 van 3 updates veilig uitgevoerd' })).toBeVisible()
  await expect.poll(async () => (await sentMails()).filter(m => m.to.includes(owner.email) && m.subject.includes('Update vraagt aandacht')).length, { timeout: 30_000 }).toBe(1)
})
