import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { clearMails, db, sentMails } from './support/env'
import { signupWithAgency } from './support/flows'

/**
 * 1. Alarm voor de beheerder: een fout in de Stripe-webhook levert één mail op (niet bij elke controle).
 * 2. Bureau en account verwijderen: abonnement gestopt, alles weg uit de database, accounts weg, bestanden
 *    in Storage opgeruimd door de worker, en inloggen kan niet meer.
 */
const run = Date.now().toString(36)
const STORAGE = process.env.STORAGE_DIR ?? '/tmp/verploy-local/storage'
const filesUnder = (dir: string): string[] => !fs.existsSync(dir) ? []
  : fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)])

test('alarm: fout in de Stripe-webhook → één mail naar de beheerder', async ({ request }) => {
  const c = db(); await c.connect()
  try {
    await c.query(`delete from public.ops_events; delete from public.ops_alert_state; update public.ops_config set alert_email = 'ops@example.test'`)
    const token = (await c.query(`select cron_token from public.ops_config`)).rows[0].cron_token as string
    expect((await request.post('/api/cron/ops', { headers: { authorization: 'Bearer nope' } })).status()).toBe(401)
    await clearMails()
    await c.query(`insert into public.ops_events (source, kind, detail) values ('stripe', 'webhook_failed', 'customer.subscription.updated evt_1: boom')`)
    const first = await (await request.post('/api/cron/ops', { headers: { authorization: `Bearer ${token}` } })).json()
    expect(first).toMatchObject({ ok: true, fresh: 1, mailed: true })
    const again = await (await request.post('/api/cron/ops', { headers: { authorization: `Bearer ${token}` } })).json()
    expect(again).toMatchObject({ ok: true, fresh: 0, mailed: false })
    const mails = (await sentMails()).filter(m => m.to.includes('ops@example.test'))
    expect(mails).toHaveLength(1)
    expect(mails[0]!.subject).toBe('Verploy alarm: Fout in de Stripe-webhook: webhook_failed')
    expect(mails[0]!.text).toContain('evt_1: boom')
  } finally {
    await c.query(`delete from public.ops_events; delete from public.ops_alert_state; update public.ops_config set alert_email = null`)
    await c.end()
  }
})

test('bureau en account verwijderen: alles weg, ook de bestanden', async ({ page }) => {
  const who = { email: `weg-${run}@example.test`, password: 'correct-horse-battery' }
  const name = `Weg ${run}`
  await signupWithAgency(page, who, name)
  const c = db(); await c.connect()
  try {
    const agency = (await c.query(`select a.id from public.agencies a where a.name = $1`, [name])).rows[0].id as string
    // Betaald abonnement (stripe-mock kent elk id) en bestanden in Storage.
    await c.query(`update public.agencies set stripe_customer_id = $2, stripe_subscription_id = $3, plan_status = 'active' where id = $1`, [agency, `cus_weg_${run}`, `sub_weg_${run}`])
    for (const f of [`run-artifacts/${agency}/r1/production_before/home-desktop.jpg`, `reports/${agency}/s1/rep.pdf`, `branding/${agency}/logo-x.png`]) {
      fs.mkdirSync(path.dirname(path.join(STORAGE, f)), { recursive: true })
      fs.writeFileSync(path.join(STORAGE, f), 'x')
    }

    await page.goto('/settings/account')
    await expect(page.getByRole('heading', { name: 'Bureau en account verwijderen' })).toBeVisible()
    await expect(page.getByText('Je abonnement stopt direct')).toBeVisible()
    await page.getByLabel(`Typ ${name} om te bevestigen`).fill('verkeerd')
    await page.getByRole('button', { name: 'Alles definitief verwijderen' }).click()
    await expect(page.getByText(`Typ precies ${name} om te bevestigen.`)).toBeVisible()
    await page.getByLabel(`Typ ${name} om te bevestigen`).fill(name)
    await page.getByRole('button', { name: 'Alles definitief verwijderen' }).click()
    await expect(page).toHaveURL(/\/login\?deleted=1/)
    await expect(page.getByText('Je bureau en account zijn verwijderd.')).toBeVisible()

    expect((await c.query(`select count(*)::int n from public.agencies where id = $1`, [agency])).rows[0].n).toBe(0)
    expect((await c.query(`select count(*)::int n from auth.users where email = $1`, [who.email])).rows[0].n).toBe(0)
    await expect.poll(() => ['run-artifacts', 'reports', 'branding'].flatMap(b => filesUnder(path.join(STORAGE, b, agency))), { timeout: 60_000 }).toEqual([])
    expect((await c.query(`select count(*)::int n from public.storage_purges where prefix like $1`, [`${agency}%`])).rows[0].n).toBe(0)

    // Inloggen kan niet meer.
    await page.getByLabel('E-mailadres').fill(who.email)
    await page.getByLabel('Wachtwoord').fill(who.password)
    await page.getByRole('button', { name: 'Inloggen' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText('E-mailadres of wachtwoord klopt niet.')).toBeVisible()
  } finally { await c.end() }
})
