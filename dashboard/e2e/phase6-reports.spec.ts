import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { expect, test } from '@playwright/test'
import { clearMails, db, sentMails } from './support/env'
import { addAndPairWordPress, login, signupWithAgency } from './support/flows'

/**
 * Fase 6: white-label rapport. Klant instellen (Duits), logo uploaden, rapport maken en
 * direct naar de klant sturen → PDF (Duits, met logo/naam van het bureau, zonder Verploy) in de e-mail.
 */
const run = Date.now().toString(36)
test.describe.configure({ mode: 'serial' })
const owner = { email: `rapport-${run}@example.test`, password: 'correct-horse-battery' }
const client = `kunde-${run}@example.test`

function pdfText(buf: Buffer): string {
  const file = path.join(os.tmpdir(), `vp-${run}.pdf`)
  fs.writeFileSync(file, buf)
  return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
}

test('rapport: klant in het Duits, logo, versturen naar de klant, downloaden', async ({ page, context }) => {
  test.setTimeout(3 * 60_000)
  await signupWithAgency(page, owner, `Agentur Nord ${run}`)
  const siteId = await addAndPairWordPress(page, context, 'Bäckerei Schmidt')

  // Klant en rapporttaal op de sitepagina
  await page.getByText('Klant en rapporten').click()
  await page.getByLabel('Naam van de klant').fill('Bäckerei Schmidt GmbH')
  await page.getByLabel('E-mailadres van de klant').fill(client)
  await page.getByLabel('Taal van rapporten').selectOption('de')
  await page.getByRole('button', { name: 'Opslaan' }).last().click()
  await expect(page.getByText('Opgeslagen.').last()).toBeVisible()

  // Logo en afzender in de instellingen
  const png = new PNG({ width: 120, height: 40 })
  png.data.fill(0x33)
  const logo = path.join(os.tmpdir(), `logo-${run}.png`)
  fs.writeFileSync(logo, PNG.sync.write(png))
  await page.goto('/settings')
  await page.getByLabel('Afzender van rapporten').fill('Agentur Nord')
  await page.getByRole('button', { name: 'Opslaan' }).first().click()
  await expect(page.getByText('Opgeslagen.').first()).toBeVisible()
  await page.locator('input[name=logo]').setInputFiles(logo)
  await page.getByRole('button', { name: 'Logo uploaden' }).click()
  await expect(page.getByRole('img', { name: 'Huidig logo' })).toBeVisible()
  // Een "logo" dat geen afbeelding is, wordt geweigerd (inhoud, niet de extensie, telt)
  const fake = path.join(os.tmpdir(), `fake-${run}.png`)
  fs.writeFileSync(fake, '<svg onload="alert(1)"></svg>')
  await page.locator('input[name=logo]').setInputFiles(fake)
  await page.getByRole('button', { name: 'Logo uploaden' }).click()
  await expect(page.getByText('Gebruik een PNG-, JPG- of WebP-bestand van maximaal 1 MB.')).toBeVisible()

  // Rapport maken en versturen
  await clearMails()
  await page.goto(`/sites/${siteId}`)
  await page.getByRole('link', { name: 'Rapport maken' }).click()
  await expect(page).toHaveURL(new RegExp(`/reports\\?site=${siteId}`))
  await page.getByLabel('Deze maand tot vandaag').check()
  await page.getByLabel(/Ook per e-mail naar de klant sturen/).check()
  await page.getByRole('button', { name: 'Rapport maken' }).click()
  await expect(page.getByText('Het rapport wordt gemaakt en verschijnt zo in de lijst.')).toBeVisible()
  await expect(page.getByText(`Verstuurd naar ${client}`)).toBeVisible({ timeout: 90_000 })

  // E-mail: white-label, Duits, met PDF-bijlage
  const mail = (await sentMails()).find(m => m.to.includes(client))!
  expect(mail.subject).toMatch(/^Wartungsbericht Bäckerei Schmidt – /)
  expect(mail.from).toMatch(/^"Agentur Nord" </)
  expect(`${mail.html}${mail.text}`.toLowerCase()).not.toContain('verploy')
  const attachments = (mail as unknown as { attachments: { filename: string; content: string | { type: string; data: number[] } }[] }).attachments
  expect(attachments).toHaveLength(1)
  expect(attachments[0]!.filename).toMatch(/^wartungsbericht-backerei-schmidt-\d{4}-\d{2}\.pdf$/)
  const content = attachments[0]!.content
  const pdf = typeof content === 'string' ? Buffer.from(content, 'base64') : Buffer.from(content.data)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  const text = pdfText(pdf)
  expect(text).toContain('Wartungsbericht')
  expect(text).toContain('Bäckerei Schmidt')
  expect(text).toContain('Kunde: Bäckerei Schmidt GmbH')
  expect(text).toContain('Verfügbarkeit')
  expect(text).toContain('Erstellt von Agentur Nord')
  expect(text.toLowerCase()).not.toContain('verploy')

  // Downloaden uit het dashboard
  const res = await page.request.get(await page.getByRole('link', { name: 'Downloaden' }).first().getAttribute('href') ?? '')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('application/pdf')
  expect(res.headers()['content-disposition']).toMatch(/^attachment;/)
  // Bekijken: dezelfde PDF, maar in de browser (nieuw tabblad)
  const view = page.getByRole('link', { name: 'Bekijken' }).first()
  await expect(view).toHaveAttribute('target', '_blank')
  const viewed = await page.request.get(await view.getAttribute('href') ?? '')
  expect(viewed.headers()['content-disposition']).toMatch(/^inline;/)
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-')
})

test('rapport-PDF van een ander bureau is niet te downloaden', async ({ page }) => {
  await signupWithAgency(page, { email: `vreemd-${run}@example.test`, password: 'correct-horse-battery-2' }, `Ander ${run}`)
  const c = (await import('./support/env')).db()
  await c.connect()
  const { rows } = await c.query(`select r.id from public.reports r join public.agencies a on a.id = r.agency_id where a.name = $1 limit 1`, [`Agentur Nord ${run}`])
  await c.end()
  expect(rows).toHaveLength(1)
  const res = await page.request.get(`/report-files/${rows[0].id}`)
  expect(res.status()).toBe(404)
})

test('rapport verwijderen: eerst bevestigen, daarna zijn record en PDF weg', async ({ page }) => {
  await login(page, owner)
  await page.goto('/reports')
  const c = db(); await c.connect()
  try {
    const before = await c.query(`select r.id, r.pdf_path from public.reports r join public.agencies a on a.id = r.agency_id where a.name = $1 order by r.created_at`, [`Agentur Nord ${run}`])
    expect(before.rows.length).toBeGreaterThan(0)
    const target = before.rows[0] as { id: string; pdf_path: string }
    expect(fs.existsSync(path.join(process.env.STORAGE_DIR ?? '/tmp/verploy-local/storage', 'reports', target.pdf_path))).toBe(true)
    const row = page.locator(`tr[data-report="${target.id}"]`)
    await row.getByRole('button', { name: 'Verwijderen' }).click()
    await expect(row.getByText('Dit rapport en de PDF definitief verwijderen?')).toBeVisible()
    await row.getByRole('button', { name: 'Annuleren' }).click()               // annuleren laat alles staan
    await row.getByRole('button', { name: 'Verwijderen' }).click()
    await row.getByRole('button', { name: 'Ja, verwijderen' }).click()
    await expect(row).toHaveCount(0)                                        // de rij verdwijnt direct
    const after = await c.query(`select count(*)::int n from public.reports where id = $1`, [target.id])
    expect(after.rows[0].n).toBe(0)
    // lokale stand-in van Supabase Storage bewaart objecten als bestanden
    expect(fs.existsSync(path.join(process.env.STORAGE_DIR ?? '/tmp/verploy-local/storage', 'reports', target.pdf_path))).toBe(false)
    expect((await page.request.get(`/report-files/${target.id}`)).status()).toBe(404)
  } finally { await c.end() }
})
