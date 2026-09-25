import { expect, test } from '@playwright/test'
import { enableTwoFactor, signupWithAgency } from './support/flows'
import { totp } from './support/totp'

/**
 * Tweestapsverificatie voor Verploy-accounts: aanzetten (QR-code + één code), daarna vraagt inloggen na het
 * wachtwoord om de code; een verkeerde code wordt geweigerd; zonder code geen toegang tot de app; uitzetten.
 */
const run = Date.now().toString(36)
const owner = { email: `tweestaps-${run}@example.test`, password: 'correct-horse-battery' }

test('aanzetten, inloggen met code, verkeerde code geweigerd, uitzetten', async ({ page, context }) => {
  await signupWithAgency(page, owner, `Tweestaps ${run}`)
  await page.goto('/settings/account')
  await expect(page.getByText('Tweestapsverificatie staat uit.')).toBeVisible()
  const secret = await enableTwoFactor(page)
  await expect(page.getByRole('img', { name: 'QR-code voor je authenticator-app' })).toHaveCount(0)

  // Opnieuw inloggen: na het wachtwoord de code.
  await context.clearCookies()
  await page.goto('/login?next=%2Fsites')
  await page.getByLabel('E-mailadres').fill(owner.email)
  await page.getByLabel('Wachtwoord').fill(owner.password)
  await page.getByRole('button', { name: 'Inloggen' }).click()
  await expect(page).toHaveURL(/\/login\/2fa\?next=%2Fsites/)
  await expect(page.getByRole('heading', { name: 'Code uit je app' })).toBeVisible()

  // Zonder code: elke app-pagina stuurt terug naar de tweede stap.
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/login\/2fa/)

  // Verkeerde code → geweigerd; goede code → door naar de gevraagde pagina.
  await page.getByLabel('Code uit de app').fill(totp(secret, Date.now(), 5))
  await page.getByRole('button', { name: 'Inloggen' }).click()
  await expect(page.getByText('Deze code klopt niet of is verlopen.', { exact: false })).toBeVisible()
  await page.getByLabel('Code uit de app').fill(totp(secret))
  await page.getByRole('button', { name: 'Inloggen' }).click()
  await expect(page).toHaveURL(/\/settings$/)

  // Uitzetten; daarna weer gewoon inloggen met alleen het wachtwoord.
  await page.goto('/settings/account')
  await page.getByRole('button', { name: 'Uitzetten' }).click()
  await expect(page.getByText('Tweestapsverificatie staat uit.')).toBeVisible()
  await context.clearCookies()
  await page.goto('/login')
  await page.getByLabel('E-mailadres').fill(owner.email)
  await page.getByLabel('Wachtwoord').fill(owner.password)
  await page.getByRole('button', { name: 'Inloggen' }).click()
  await expect(page).not.toHaveURL(/\/login/)
})
