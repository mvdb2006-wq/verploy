import { expect, type BrowserContext, type Page } from '@playwright/test'
import { WP, WP_PASS, WP_USER } from './env'

export interface Account { email: string; password: string }

export async function signupWithAgency(page: Page, who: Account, agencyName: string) {
  await page.goto('/signup')
  await page.getByLabel('E-mailadres').fill(who.email)
  await page.getByLabel('Wachtwoord').fill(who.password)
  await page.getByRole('button', { name: 'Account aanmaken' }).click()
  await expect(page).toHaveURL(/\/onboarding/)
  await page.getByLabel('Naam van je bureau').fill(agencyName)
  await page.getByRole('button', { name: 'Bureau aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Sites', level: 1 })).toBeVisible()
}

export async function login(page: Page, who: Account) {
  await page.goto('/login')
  await page.getByLabel('E-mailadres').fill(who.email)
  await page.getByLabel('Wachtwoord').fill(who.password)
  await page.getByRole('button', { name: 'Inloggen' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** Opent de Verploy-instellingen in wp-admin, en logt zo nodig eerst in. */
export async function wpAdmin(context: BrowserContext, wpUrl = WP): Promise<Page> {
  const wp = await context.newPage()
  await wp.goto(`${wpUrl}/wp-admin/options-general.php?page=verploy-connector`)
  if (await wp.locator('#user_login').isVisible()) {
    await wp.locator('#user_login').fill(WP_USER)
    await wp.locator('#user_pass').fill(WP_PASS)
    await wp.locator('#wp-submit').click()
    await wp.waitForURL(/page=verploy-connector/)
  }
  return wp
}

/** Voegt de test-WordPress toe en koppelt hem via wp-admin; geeft de site-id terug. */
export async function addAndPairWordPress(page: Page, context: BrowserContext, name = 'Test-WordPress', wpUrl = WP): Promise<string> {
  await page.goto('/sites/new')
  await page.getByLabel('Adres van de site').fill(wpUrl)
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Site toevoegen' }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]{36}/)
  const siteId = page.url().match(/sites\/([0-9a-f-]{36})/)![1]!
  await page.getByRole('button', { name: 'Koppelcode maken' }).click()
  const code = (await page.locator('output[aria-label="Koppelcode"]').textContent())!.trim()
  const wp = await wpAdmin(context, wpUrl)
  await wp.getByLabel('Koppelcode').fill(code)
  await wp.getByRole('button', { name: 'Koppelen', exact: true }).click()
  await expect(wp.locator('.notice-success, .notice-warning')).toContainText('Gekoppeld')
  await wp.close()
  await expect(page.getByText('Online').first()).toBeVisible({ timeout: 20_000 })
  return siteId
}

/** Laat de plugin direct een heartbeat sturen (knop "Verbinding testen"). */
export async function sendHeartbeat(context: BrowserContext, wpUrl = WP) {
  const wp = await wpAdmin(context, wpUrl)
  await wp.getByRole('button', { name: 'Verbinding testen' }).click()
  await expect(wp.locator('.notice-success')).toContainText('Verbinding werkt')
  await wp.close()
}
