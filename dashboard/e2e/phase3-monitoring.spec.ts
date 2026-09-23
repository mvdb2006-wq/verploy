import { expect, test } from '@playwright/test'
import { clearMails, CRON_SECRET, db, sentMails } from './support/env'
import { addAndPairWordPress, login, sendHeartbeat, signupWithAgency } from './support/flows'

const run = Date.now().toString(36)
const owner = { email: `mon-owner-${run}@example.test`, password: 'correct-horse-battery' }
let siteId = ''

async function waitForMail(match: (m: { to: string[]; subject: string }) => boolean) {
  await expect.poll(async () => (await sentMails()).find(match) ?? null, { timeout: 15_000 }).not.toBeNull()
  return (await sentMails()).find(match)!
}

test.describe.serial('Fase 3: monitoring en waarschuwingen', () => {
  test('eerste heartbeat van een http-site → waarschuwing in-app én per e-mail', async ({ page, context }) => {
    await clearMails()
    await signupWithAgency(page, owner, `Monitoring ${run}`)
    siteId = await addAndPairWordPress(page, context)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Open meldingen' })).toBeVisible()
    await expect(page.getByText('Site gebruikt geen HTTPS')).toBeVisible()
    await expect(page.getByText('geen HTTPS', { exact: true })).toBeVisible()          // gezondheidspaneel
    const mail = await waitForMail(m => m.subject === '[Waarschuwing] Site gebruikt geen HTTPS — Test-WordPress')
    expect(mail.to).toEqual([owner.email])
    expect(mail.text).toContain(`/sites/${siteId}`)
    expect(mail.text).toContain('eigenaar of beheerder')
  })

  test('onderhouds-cron zonder geldig geheim wordt geweigerd', async ({ request }) => {
    expect((await request.get('/api/cron/maintenance')).status()).toBe(401)
    expect((await request.get('/api/cron/maintenance', { headers: { authorization: 'Bearer fout' } })).status()).toBe(401)
  })

  test('geen heartbeat > 45 min → kritieke offline-melding + e-mail; heartbeat → herstelmail', async ({ page, context, request }) => {
    await clearMails()
    const c = db(); await c.connect()
    await c.query(`update public.sites set last_heartbeat_at = now() - interval '2 hours' where id = $1`, [siteId])
    await c.end()

    const res = await request.get('/api/cron/maintenance', { headers: { authorization: `Bearer ${CRON_SECRET}` } })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.evaluated).toBeGreaterThanOrEqual(1)

    const mail = await waitForMail(m => m.subject === '[Kritiek] Site is offline — Test-WordPress')
    expect(mail.to).toEqual([owner.email])

    await login(page, owner)
    await page.goto('/alerts')
    await expect(page.getByText('Site is offline')).toBeVisible()
    await expect(page.getByText('Kritiek').first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Meldingen/ }).getByText('2')).toBeVisible()   // offline + geen HTTPS

    await sendHeartbeat(context)
    await waitForMail(m => m.subject === 'Opgelost: Test-WordPress is weer online')
    await page.reload()
    await expect(page.getByText('Site is offline')).toHaveCount(0)
    await page.getByRole('link', { name: 'Opgelost (30 dagen)' }).click()
    await expect(page.getByText('Site is offline')).toBeVisible()
    await expect(page.getByText(/opgelost/).first()).toBeVisible()
  })

  test('"Gezien" haalt de melding uit de teller maar laat hem open', async ({ page }) => {
    await login(page, owner)
    await page.goto('/alerts')
    await expect(page.getByRole('link', { name: /Meldingen/ }).getByText('1')).toBeVisible()
    await page.getByRole('button', { name: 'Gezien' }).first().click()
    await expect(page.getByText('Gezien', { exact: true })).toBeVisible()
    await expect(page.getByText('Site gebruikt geen HTTPS')).toBeVisible()
    await expect(page.getByRole('link', { name: /Meldingen/ }).locator('span.rounded-full')).toHaveCount(0)
  })

  test('sitesoverzicht toont de ernst per site', async ({ page }) => {
    await login(page, owner)
    await page.goto('/')
    await expect(page.getByText('1 · Waarschuwing')).toBeVisible()
  })
})
