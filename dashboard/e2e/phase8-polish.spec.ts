import { expect, test } from '@playwright/test'
import { login, signupWithAgency } from './support/flows'

/** Fase 8: onboarding-checklist, foutpagina's, healthcheck en mobiele weergave zonder horizontaal scrollen. */
const run = Date.now().toString(36)
const owner = { email: `af-${run}@example.test`, password: 'correct-horse-battery' }
test.describe.configure({ mode: 'serial' })

test('nieuw bureau: checklist "Aan de slag" loopt mee en verdwijnt niet te vroeg', async ({ page }) => {
  await signupWithAgency(page, owner, `Afwerking ${run}`)
  const checklist = page.getByRole('region', { name: 'Aan de slag met Verploy' })
  await expect(checklist).toBeVisible()
  await expect(checklist.getByText('0 van 4 klaar')).toBeVisible()
  await checklist.getByRole('link', { name: /Voeg je eerste site toe/ }).click()
  await expect(page).toHaveURL(/\/sites\/new/)
  await page.getByLabel('Adres van de site').fill(`https://afwerking-${run}.example`)
  await page.getByLabel('Naam', { exact: true }).fill('Afwerking')
  await page.getByRole('button', { name: 'Site toevoegen' }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]{36}/)
  await page.goto('/')
  await expect(checklist.getByText('1 van 4 klaar')).toBeVisible()
  // volgende stap is uitgelicht en linkt naar de site om te koppelen
  await expect(checklist.getByRole('link', { name: /Koppel de site/ })).toHaveAttribute('href', /\/sites\/[0-9a-f-]{36}$/)
})

test('onbekende pagina: nette 404 in de taal van de gebruiker (niet ingelogd → eerst inloggen)', async ({ page }) => {
  await page.goto('/bestaat-niet')
  await expect(page).toHaveURL(/\/login\?next=%2Fbestaat-niet/)
  await login(page, owner)
  const res = await page.goto('/bestaat-niet')
  expect(res?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Pagina niet gevonden' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Naar het overzicht' })).toBeVisible()
})

test('healthcheck voor uptime-monitoring', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

test('mobiel (390 px): geen horizontaal scrollen op de hoofdpagina’s', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'nl-NL', isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.getByLabel('E-mailadres').fill(owner.email)
  await page.getByLabel('Wachtwoord').fill(owner.password)
  await page.getByRole('button', { name: 'Inloggen' }).click()
  await expect(page).not.toHaveURL(/\/login/)
  for (const path of ['/', '/alerts', '/reports', '/settings', '/settings/team', '/settings/billing', '/sites/new']) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
  await ctx.close()
})
