import { expect, test } from '@playwright/test'
import { db } from './support/env'
import { signupWithAgency } from './support/flows'

/** Klantoverzicht: alleen de platformbeheerder (Martijn) ziet het; klanten krijgen een 404. */
const run = Date.now().toString(36)

test('platformbeheerder ziet alle klanten, met status, CSV en detail; klant ziet niets', async ({ browser }) => {
  const adminPage = await (await browser.newContext()).newPage()
  const admin = { email: `beheer-${run}@example.test`, password: 'correct-horse-battery' }
  await signupWithAgency(adminPage, admin, `Beheer ${run}`)
  const klantPage = await (await browser.newContext()).newPage()
  const klant = { email: `klant-${run}@example.test`, password: 'correct-horse-battery' }
  await signupWithAgency(klantPage, klant, `Klant ${run}`)

  const c = db(); await c.connect()
  try {
    await c.query(`insert into public.platform_admins (user_id) select id from auth.users where email = $1`, [admin.email])
    await c.query(`update public.agencies set plan_status = 'past_due', plan_id = 'solo', stripe_subscription_id = $2, stripe_customer_id = $3 where name = $1`, [`Klant ${run}`, `sub_k_${run}`, `cus_k_${run}`])
  } finally { await c.end() }

  // Klant: geen menu-item en een 404 op de URL.
  await klantPage.goto('/')
  await expect(klantPage.getByRole('link', { name: 'Klanten' })).toHaveCount(0)
  const res = await klantPage.goto('/admin/customers')
  expect(res?.status()).toBe(404)
  expect((await klantPage.request.get('/admin/customers/export')).status()).toBe(404)

  // Beheerder: menu-item, tegels, rij "te laat" en detail.
  await adminPage.goto('/')
  await adminPage.getByRole('link', { name: 'Klanten' }).click()
  await expect(adminPage.getByRole('heading', { name: 'Klanten', level: 1 })).toBeVisible()
  const row = adminPage.getByRole('row').filter({ hasText: `Klant ${run}` })
  await expect(row.getByText('Te laat')).toBeVisible()
  await expect(row.getByText(klant.email)).toBeVisible()
  await adminPage.getByLabel('Zoek op bureau of e-mail').fill(`beheer-${run}`)
  await expect(adminPage.getByRole('row').filter({ hasText: `Klant ${run}` })).toHaveCount(0)
  await expect(adminPage.getByRole('row').filter({ hasText: `Beheer ${run}` }).getByText(/^Proef t\/m/)).toBeVisible()
  await adminPage.getByLabel('Zoek op bureau of e-mail').fill('')
  await adminPage.getByRole('link', { name: `Klant ${run}` }).click()
  await expect(adminPage.getByRole('heading', { name: `Klant ${run}`, level: 1 })).toBeVisible()
  await expect(adminPage.getByRole('link', { name: /Bekijk in Stripe/ })).toHaveAttribute('href', `https://dashboard.stripe.com/customers/cus_k_${run}`)

  const csv = await adminPage.request.get('/admin/customers/export')
  expect(csv.status()).toBe(200)
  expect(csv.headers()['content-type']).toContain('text/csv')
  expect(await csv.text()).toContain(`Klant ${run};${klant.email};Solo;Te laat;19,00`)
})
