import { expect, test, type Page } from '@playwright/test'
import { db } from './support/env'
import { signupWithAgency } from './support/flows'

/**
 * Conversiepad verploy.com → app: plankeuze (?plan=) en taal (?lang= of herkomst van verploy.com).
 *   pricing op verploy.com → /signup?plan=agency → account → bureau → plan bewaard → abonnement → Agency voorgeselecteerd
 * Het plan uit de URL is alleen een voorkeur: limieten en betaalstatus veranderen niet.
 */
const run = Date.now().toString(36)
const PRICES = { solo: 'price_e2e_solo', studio: 'price_e2e_studio', agency: 'price_e2e_agency', scale: 'price_e2e_scale' } as const

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const c = db(); await c.connect()
  try {
    for (const [plan, price] of Object.entries(PRICES)) await c.query(`update public.plans set stripe_price_id = $2 where id = $1`, [plan, price])
  } finally { await c.end() }
})

async function account(email: string) {
  const c = db(); await c.connect()
  try {
    const { rows } = await c.query(`select u.raw_user_meta_data->>'intended_plan' intended, a.dashboard_locale, a.plan_id, a.plan_status, a.stripe_subscription_id
      from auth.users u left join public.agency_members m on m.user_id = u.id left join public.agencies a on a.id = m.agency_id where u.email = $1`, [email])
    return rows[0] as { intended: string | null; dashboard_locale: string | null; plan_id: string | null; plan_status: string | null; stripe_subscription_id: string | null }
  } finally { await c.end() }
}

async function interceptCheckout(page: Page) {
  const seen = { url: '' }
  await page.route('https://checkout.stripe.com/**', route => { seen.url = route.request().url(); return route.fulfill({ status: 200, body: 'stripe checkout' }) })
  return seen
}

test('van verploy.com (Engels, Agency): account → bureau → plan bewaard → Agency voorgeselecteerd bij het abonnement', async ({ page }) => {
  const who = { email: `plan-en-${run}@example.test`, password: 'correct-horse-battery' }
  // Zoals de knop "Create account with Agency" op verploy.com/start/: geen ?lang=, wel de herkomst.
  await page.goto('/signup?plan=agency', { referer: 'https://verploy.com/start/?plan=agency' })
  await expect(page.getByRole('heading', { name: 'Create an account', level: 1 })).toBeVisible()
  const chosen = page.getByRole('complementary', { name: 'Selected plan' })
  await expect(chosen.getByText('Selected plan: Agency')).toBeVisible()
  await expect(chosen.getByText(/€99 per month · 40 sites/)).toBeVisible()
  await expect(chosen.getByText('During the trial you can connect up to 15 sites; all 40 sites of Agency unlock when you subscribe.')).toBeVisible()

  await page.getByLabel('Email address').fill(who.email)
  await page.getByLabel('Password').fill(who.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Create your agency' })).toBeVisible()       // taal blijft Engels
  await page.getByLabel('Agency name').fill(`Plan EN ${run}`)
  await page.getByRole('button', { name: 'Create agency' }).click()
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()

  // Plan bewaard bij het account; het bureau houdt de gewone proefperiode (limieten/betaalstatus ongewijzigd).
  expect(await account(who.email)).toEqual({ intended: 'agency', dashboard_locale: 'en', plan_id: 'studio', plan_status: 'trialing', stripe_subscription_id: null })

  await page.goto('/settings/billing')
  await expect(page.getByRole('heading', { name: 'You chose Agency' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Agency' }).getByText('Your choice')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Studio' }).getByText('Your choice')).toHaveCount(0)
  const seen = await interceptCheckout(page)
  const cta = page.getByRole('button', { name: 'Subscribe to Agency' })
  await expect(cta.locator('xpath=ancestor::form//input[@name="plan"]')).toHaveValue('agency')
  await cta.click()
  await expect.poll(() => seen.url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
})

test('bestaande Nederlandse registratie zonder plan: Nederlands, geen voorselectie', async ({ page }) => {
  const who = { email: `plan-nl-${run}@example.test`, password: 'correct-horse-battery' }
  await page.goto('/signup')
  await expect(page.getByRole('heading', { name: 'Account aanmaken', level: 1 })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Gekozen plan' })).toHaveCount(0)
  await signupWithAgency(page, who, `Plan NL ${run}`)
  expect(await account(who.email)).toMatchObject({ intended: null, dashboard_locale: 'nl', plan_id: 'studio', plan_status: 'trialing' })
  await page.goto('/settings/billing')
  await expect(page.getByText('Jouw keuze')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Studio' }).getByRole('button', { name: 'Kiezen' })).toBeVisible()
})

test('ongeldig plan: geen foutmelding, gewone registratie, niets bewaard', async ({ page }) => {
  const who = { email: `plan-bad-${run}@example.test`, password: 'correct-horse-battery' }
  const res = await page.goto('/signup?plan=enterprise%3Bdrop&lang=xx')
  expect(res?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Account aanmaken', level: 1 })).toBeVisible()   // onbekende taal → bestaande logica
  await expect(page.getByRole('complementary', { name: 'Gekozen plan' })).toHaveCount(0)
  await page.getByLabel('E-mailadres').fill(who.email)
  await page.getByLabel('Wachtwoord').fill(who.password)
  await page.getByRole('button', { name: 'Account aanmaken' }).click()
  await expect(page).toHaveURL(/\/onboarding/)
  expect((await account(who.email)).intended).toBeNull()
})

test('expliciete ?lang=en en al ingelogd: plan gaat mee naar het abonnement', async ({ page }) => {
  await page.goto('/signup?plan=scale&lang=en')
  await expect(page.getByRole('complementary', { name: 'Selected plan' }).getByText('Selected plan: Scale')).toBeVisible()
  // De taalkeuze blijft bewaard: ook de inlogpagina is nu Engels.
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  // Al een account (het Nederlandse bureau hierboven): inloggen en opnieuw via verploy.com met Solo.
  await page.getByLabel('Email address').fill(`plan-nl-${run}@example.test`)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
  await page.goto('/signup?plan=solo')
  await expect(page).toHaveURL(/\/settings\/billing\?plan=solo$/)
  await expect(page.getByRole('region', { name: 'Solo' }).getByText('Jouw keuze')).toBeVisible()   // bureau is Nederlands
  const seen = await interceptCheckout(page)
  await page.getByRole('button', { name: 'Solo afsluiten' }).click()
  await expect.poll(() => seen.url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
})
