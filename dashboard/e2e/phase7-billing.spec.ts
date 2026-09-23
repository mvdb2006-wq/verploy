import Stripe from 'stripe'
import { expect, test, type Page } from '@playwright/test'
import { db } from './support/env'
import { login, signupWithAgency } from './support/flows'

/**
 * Fase 7: abonneren, upgraden/downgraden, opzeggen. Stripe-API = stripe-mock (officiële mock van
 * Stripe, geeft vaste voorbeeldobjecten terug); de status komt — net als in productie — via
 * ondertekende webhooks binnen, die deze test zelf ondertekent met het webhookgeheim.
 */
const WEBHOOK_SECRET = process.env.E2E_STRIPE_WEBHOOK_SECRET ?? 'whsec_e2e_local'
const stripe = new Stripe('sk_test_e2e')
const run = Date.now().toString(36)
const owner = { email: `abo-${run}@example.test`, password: 'correct-horse-battery' }
const PRICES = { solo: `price_e2e_solo`, studio: `price_e2e_studio`, agency: `price_e2e_agency`, scale: `price_e2e_scale` } as const
let agencyId = ''
let customer = ''
let eventSeq = 0

test.describe.configure({ mode: 'serial' })

async function sendSubscriptionEvent(page: Page, type: string, over: { price: string; status?: string; cancelAtEnd?: boolean }) {
  const now = Math.floor(Date.now() / 1000) + eventSeq
  const event = {
    id: `evt_e2e_${run}_${++eventSeq}`, object: 'event', type, created: now, api_version: '2026-08-26.dahlia', livemode: false,
    data: { object: {
      id: `sub_e2e_${run}`, object: 'subscription', customer, status: over.status ?? 'active',
      cancel_at_period_end: over.cancelAtEnd ?? false, cancel_at: null, metadata: { agency_id: agencyId },
      items: { object: 'list', data: [{ id: `si_e2e_${run}`, object: 'subscription_item', current_period_end: now + 30 * 86400, price: { id: over.price, object: 'price' } }] },
    } },
  }
  const payload = JSON.stringify(event)
  const res = await page.request.post('/api/stripe/webhook', {
    data: payload, headers: { 'content-type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) },
  })
  return { status: res.status(), body: await res.json(), payload }
}

test.beforeAll(async () => {
  const c = db(); await c.connect()
  try {
    for (const [plan, price] of Object.entries(PRICES)) await c.query(`update public.plans set stripe_price_id = $2 where id = $1`, [plan, price])
  } finally { await c.end() }
})

test('abonneren: Checkout starten, webhook maakt het abonnement actief', async ({ page }) => {
  await signupWithAgency(page, owner, `Abo ${run}`)
  await page.goto('/settings')
  await page.getByRole('link', { name: 'Abonnement beheren' }).click()
  await expect(page.getByRole('heading', { name: 'Abonnement', level: 1 })).toBeVisible()
  await expect(page.getByText(/Proefperiode tot/)).toBeVisible()
  for (const [name, price] of [['Solo', '€ 19'], ['Studio', '€ 49'], ['Agency', '€ 99'], ['Scale', '€ 249']] as const) {
    await expect(page.getByRole('region', { name }).getByText(price)).toBeVisible()
  }
  // Checkout: we volgen de redirect naar Stripe niet (extern), maar controleren wél de bestemming
  let checkoutUrl = ''
  await page.route('https://checkout.stripe.com/**', route => { checkoutUrl = route.request().url(); return route.fulfill({ status: 200, body: 'stripe checkout' }) })
  await page.getByRole('region', { name: 'Studio' }).getByRole('button', { name: 'Kiezen' }).click()
  await expect.poll(() => checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//)

  const c = db(); await c.connect()
  try {
    const { rows } = await c.query(`select id, stripe_customer_id from public.agencies where name = $1`, [`Abo ${run}`])
    agencyId = rows[0].id
    customer = rows[0].stripe_customer_id
  } finally { await c.end() }
  expect(customer).toMatch(/^cus_/)

  const r = await sendSubscriptionEvent(page, 'customer.subscription.created', { price: PRICES.studio })
  expect(r).toMatchObject({ status: 200, body: { outcome: 'applied' } })
  await page.goto('/settings/billing')
  await expect(page.getByRole('region', { name: 'Studio' }).getByText('Huidig')).toBeVisible()
  await expect(page.getByText(/Actief · Wordt verlengd op/)).toBeVisible()
})

test('webhook: vervalste handtekening geweigerd, zelfde event twee keer = één keer verwerkt', async ({ page }) => {
  const bad = await page.request.post('/api/stripe/webhook', { data: '{"id":"evt_x","type":"customer.subscription.updated"}', headers: { 'stripe-signature': 't=1,v1=00' } })
  expect(bad.status()).toBe(400)
  const first = await sendSubscriptionEvent(page, 'customer.subscription.updated', { price: PRICES.studio })
  const replay = await page.request.post('/api/stripe/webhook', {
    data: first.payload, headers: { 'content-type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload: first.payload, secret: WEBHOOK_SECRET }) },
  })
  expect((await replay.json()).outcome).toBe('duplicate_or_stale')
})

test('upgraden en downgraden; downgraden onder het aantal sites wordt geweigerd', async ({ page }) => {
  await login(page, owner)
  await page.goto('/settings/billing')
  await page.getByRole('region', { name: 'Agency' }).getByRole('button', { name: 'Overstappen' }).click()
  await expect(page.getByText('Wijziging doorgegeven. Het nieuwe abonnement is binnen enkele seconden actief.')).toBeVisible()
  await sendSubscriptionEvent(page, 'customer.subscription.updated', { price: PRICES.agency })
  await page.reload()
  await expect(page.getByRole('region', { name: 'Agency' }).getByText('Huidig')).toBeVisible()

  // Twee sites, en Solo tijdelijk op 1 site: downgraden naar Solo moet geweigerd worden
  for (const n of [1, 2]) {
    await page.goto('/sites/new')
    await page.getByLabel('Adres van de site').fill(`https://abo-${run}-${n}.example`)
    await page.getByLabel('Naam', { exact: true }).fill(`Abo-site ${n}`)
    await page.getByRole('button', { name: 'Site toevoegen' }).click()
    await expect(page).toHaveURL(/\/sites\/[0-9a-f-]{36}/)
  }
  const c = db(); await c.connect()
  await c.query(`update public.plans set sites_limit = 1 where id = 'solo'`)
  try {
    await page.goto('/settings/billing')
    await page.getByRole('region', { name: 'Solo' }).getByRole('button', { name: 'Overstappen' }).click()
    await expect(page.getByText('Je hebt nu 2 sites en Solo is voor maximaal 1. Verwijder eerst sites of kies een groter abonnement.')).toBeVisible()
  } finally {
    await c.query(`update public.plans set sites_limit = 5 where id = 'solo'`)
    await c.end()
  }
})

test('opzeggen aan het einde van de periode, weer doorgaan, en beëindigd = alleen-lezen', async ({ page }) => {
  await login(page, owner)
  await page.goto('/settings/billing')
  await page.getByRole('button', { name: 'Abonnement opzeggen' }).click()
  await expect(page.getByText('Opzegging doorgegeven.')).toBeVisible()
  await sendSubscriptionEvent(page, 'customer.subscription.updated', { price: PRICES.agency, cancelAtEnd: true })
  await page.reload()
  await expect(page.getByText(/^Stopt op /)).toBeVisible()
  await page.getByRole('button', { name: 'Toch doorgaan' }).click()
  await expect(page.getByText('Het abonnement loopt weer door.')).toBeVisible()

  await sendSubscriptionEvent(page, 'customer.subscription.deleted', { price: PRICES.agency, status: 'canceled' })
  await page.reload()
  await expect(page.getByText('Opgezegd. Monitoring loopt door, maar voor nieuwe sites en updates is een abonnement nodig.')).toBeVisible()
  // Alleen-lezen wordt server-side afgedwongen: nieuwe site wordt geweigerd
  await page.goto('/sites/new')
  await page.getByLabel('Adres van de site').fill(`https://abo-${run}-3.example`)
  await page.getByLabel('Naam', { exact: true }).fill('Abo-site 3')
  await page.getByRole('button', { name: 'Site toevoegen' }).click()
  await expect(page).toHaveURL(/\/sites\/new/)
  // en na een nieuw abonnement mag het weer
  await sendSubscriptionEvent(page, 'customer.subscription.created', { price: PRICES.scale })
  await page.goto('/settings/billing')
  await expect(page.getByRole('region', { name: 'Scale' }).getByText('Huidig')).toBeVisible()
})

test('alleen de eigenaar mag het abonnement wijzigen (beheerder ziet geen knoppen)', async ({ page }) => {
  const admin = { email: `abo-admin-${run}@example.test`, password: 'correct-horse-battery-2' }
  await page.goto('/signup')
  await page.getByLabel('E-mailadres').fill(admin.email)
  await page.getByLabel('Wachtwoord').fill(admin.password)
  await page.getByRole('button', { name: 'Account aanmaken' }).click()
  await expect(page).toHaveURL(/\/onboarding/)
  const c = db(); await c.connect()
  try {
    await c.query(`insert into public.agency_members (agency_id, user_id, role) select $1, id, 'admin' from auth.users where email = $2`, [agencyId, admin.email])
  } finally { await c.end() }
  await page.goto('/settings/billing')
  await expect(page.getByText('Alleen de eigenaar van het bureau kan het abonnement wijzigen.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Overstappen|Kiezen|Abonnement opzeggen/ })).toHaveCount(0)
})
