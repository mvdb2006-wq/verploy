import { expect, test, type Page } from '@playwright/test'

import { WP, WP_PASS, WP_USER } from './support/env'
const run = Date.now().toString(36)
const owner = { email: `owner-${run}@example.test`, password: 'correct-horse-battery' }
const colleague = { email: `collega-${run}@example.test`, password: 'correct-horse-battery-2' }
const stranger = { email: `vreemde-${run}@example.test`, password: 'correct-horse-battery-3' }

async function signup(page: Page, who: { email: string; password: string }, next?: string) {
  await page.goto(next ? `/signup?next=${encodeURIComponent(next)}` : '/signup')
  await page.getByLabel('E-mailadres').fill(who.email)
  await page.getByLabel('Wachtwoord').fill(who.password)
  await page.getByRole('button', { name: 'Account aanmaken' }).click()
}

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('E-mailadres').fill(who.email)
  await page.getByLabel('Wachtwoord').fill(who.password)
  await page.getByRole('button', { name: 'Inloggen' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Uitloggen' }).last().click()
  await expect(page).toHaveURL(/\/login/)
}

test.describe.serial('Fase 2: registreren → bureau → site koppelen → data binnen', () => {
  let siteUrlInApp = ''

  test('nieuw bureau registreert en ziet een lege staat', async ({ page }) => {
    await signup(page, owner)
    await expect(page).toHaveURL(/\/onboarding/)
    await page.getByLabel('Naam van je bureau').fill(`E2E Webbureau ${run}`)
    await page.getByRole('button', { name: 'Bureau aanmaken' }).click()
    await expect(page.getByRole('heading', { name: 'Sites', level: 1 })).toBeVisible()
    await expect(page.getByText('Nog geen sites')).toBeVisible()
    await expect(page.getByText(/Proefperiode: nog 14 dagen/)).toBeVisible()
  })

  test('site toevoegen: ongeldige URL geeft een duidelijke fout', async ({ page }) => {
    await login(page, owner)
    await page.getByRole('link', { name: 'Site toevoegen' }).first().click()
    await page.getByLabel('Adres van de site').fill('geen adres')
    await page.getByLabel('Naam', { exact: true }).fill('Testsite')
    await page.getByRole('button', { name: 'Site toevoegen' }).click()
    await expect(page.locator('form').getByRole('alert')).toContainText('geldig webadres')
  })

  test('site toevoegen, koppelcode maken, koppelen in wp-admin, data verschijnt', async ({ page, context }) => {
    await login(page, owner)
    await page.goto('/sites/new')
    await page.getByLabel('Adres van de site').fill(WP)
    await page.getByLabel('Naam', { exact: true }).fill('Test-WordPress')
    await page.getByLabel(/Naam van de klant/).fill('Klant BV')
    await page.getByRole('button', { name: 'Site toevoegen' }).click()
    await expect(page).toHaveURL(/\/sites\/[0-9a-f-]{36}/)
    siteUrlInApp = page.url()
    await expect(page.getByRole('heading', { name: 'Site koppelen' })).toBeVisible()
    await expect(page.getByText('Wacht op koppeling')).toBeVisible()

    // Download-link levert een echte ZIP
    const dl = await page.request.get('/api/v1/plugin/download')
    expect(dl.status()).toBe(200)
    expect(dl.headers()['content-type']).toBe('application/zip')
    expect((await dl.body()).subarray(0, 2).toString()).toBe('PK')

    await page.getByRole('button', { name: 'Koppelcode maken' }).click()
    const code = (await page.getByRole('status', { name: 'Koppelcode' }).or(page.locator('output[aria-label="Koppelcode"]')).first().textContent())!.trim()
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)

    // In WordPress koppelen, precies zoals een bureau dat doet
    const wp = await context.newPage()
    await wp.goto(`${WP}/wp-login.php`)
    await wp.locator('#user_login').fill(WP_USER)
    await wp.locator('#user_pass').fill(WP_PASS)
    await wp.locator('#wp-submit').click()
    await wp.goto(`${WP}/wp-admin/options-general.php?page=verploy-connector`)
    await wp.getByLabel('Koppelcode').fill(code.toLowerCase().replace(/(.{4})/, '$1-'))  // gebruikers tikken soms kleine letters/streepje
    await wp.getByRole('button', { name: 'Koppelen', exact: true }).click()
    await expect(wp.locator('.notice-success')).toContainText('Gekoppeld')
    await expect(wp.getByText('Status: Gekoppeld')).toBeVisible()

    // Dashboard ververst vanzelf en toont de binnengekomen data
    await expect(page.getByText('Online').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Plugins en thema\'s')).toBeVisible()
    await expect(page.getByText('Verploy Connector')).toBeVisible()
    await expect(page.locator('dd').filter({ hasText: /^7\.\d/ })).toBeVisible()   // WordPress-versie
    await expect(page.locator('dd').filter({ hasText: '2.0.0' })).toBeVisible()      // connector-versie

    // Tweede heartbeat via "Verbinding testen" werkt ook (nieuwe nonce, zelfde secret)
    await wp.getByRole('button', { name: 'Verbinding testen' }).click()
    await expect(wp.locator('.notice-success')).toContainText('Verbinding werkt')

    // Koppelcode is eenmalig: nogmaals gebruiken faalt met duidelijke melding
    await wp.getByLabel('Koppelcode').fill(code)
    await wp.getByRole('button', { name: 'Koppelen', exact: true }).click()
    await expect(wp.locator('.notice-error')).toContainText('ongeldig, verlopen of al gebruikt')

    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Test-WordPress' })).toBeVisible()
    await expect(page.getByText('1 site · 1 online')).toBeVisible()
  })

  test('teamlid uitnodigen: collega accepteert via link en ziet dezelfde sites', async ({ page }) => {
    await login(page, owner)
    await page.goto('/settings/team')
    await page.getByLabel('E-mailadres').fill(colleague.email)
    await page.getByRole('button', { name: 'Uitnodiging maken' }).click()
    const link = (await page.locator(`output[aria-label="Uitnodigingslink voor ${colleague.email}"]`).textContent())!.trim()
    expect(link).toMatch(/\/invite\/[0-9a-f]{48}$/)
    await signOut(page)

    await page.goto(link)
    await expect(page.getByText(/Je bent uitgenodigd voor E2E Webbureau .*, met de rol lid\./)).toBeVisible()
    await page.getByRole('link', { name: 'Account aanmaken' }).click()
    await expect(page.getByLabel('E-mailadres')).toHaveValue(colleague.email)
    await page.getByLabel('Wachtwoord').fill(colleague.password)
    await page.getByRole('button', { name: 'Account aanmaken' }).click()
    await expect(page).toHaveURL(/\/invite\//)
    await page.getByRole('button', { name: 'Uitnodiging accepteren' }).click()
    await expect(page.getByRole('link', { name: 'Test-WordPress' })).toBeVisible()
    // Een lid mag niets beheren
    await expect(page.getByRole('link', { name: 'Site toevoegen' })).toHaveCount(0)
    await signOut(page)
  })

  test('ander bureau ziet de site niet, ook niet via de directe URL', async ({ page }) => {
    await signup(page, stranger)
    await page.getByLabel('Naam van je bureau').fill(`Concurrent ${run}`)
    await page.getByRole('button', { name: 'Bureau aanmaken' }).click()
    await expect(page.getByText('Nog geen sites')).toBeVisible()
    const res = await page.goto(siteUrlInApp)
    expect(res?.status()).toBe(404)
  })

  test('plugin-API weigert ongesigneerde en vervalste heartbeats', async ({ request }) => {
    const unsigned = await request.post('/api/v2/heartbeat', { data: { schema: 2 } })
    expect(unsigned.status()).toBe(401)
    const forged = await request.post('/api/v2/heartbeat', {
      data: '{}',
      headers: {
        'x-verploy-site': '00000000-0000-4000-8000-000000000000',
        'x-verploy-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-verploy-nonce': '0'.repeat(32),
        'x-verploy-signature': 'f'.repeat(64),
      },
    })
    expect(forged.status()).toBe(401)
    const oldPlugin = await request.post('/api/v1/sites/heartbeat', { data: {} })
    expect(oldPlugin.status()).toBe(410)
  })
})
