import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { LAB_DIR, LAB_WP, LAB_WP_DIR, db } from './support/env'
import { addAndPairWordPress, signupWithAgency } from './support/flows'

/**
 * Geplande veilige updates, van begin tot eind:
 *   bureau zet "Automatische veilige updates" aan (moment: nacht) →
 *   binnen het moment voert Verploy de gewone update (vp-lab-footer 1.0.0 → 1.1.0) zelf veilig uit (trigger 'scheduled') →
 *   de grote versiesprong (vp-lab-extra 0.9.0 → 1.1.0) doet Verploy níet zelf: één vraag in de inbox →
 *   akkoord in de inbox → veilige update → live; de vraag vervalt →
 *   niet nóg een geplande run in hetzelfde venster; "Nooit automatisch" per site.
 * De browser (en dus het bureau) staat in een tijdzone waar het nu nacht is.
 */
const LAB_SCRIPTS = path.resolve(import.meta.dirname, '../../connector-plugin/tests/lab')
const CONNECTOR = path.resolve(import.meta.dirname, '../../connector-plugin/verploy-connector')
const run = Date.now().toString(36)
const owner = { email: `gepland-${run}@example.test`, password: 'correct-horse-battery' }
const wp = (...args: string[]) => execFileSync('php', ['/home/claude/tools/wp-cli.phar', '--allow-root', `--path=${LAB_WP_DIR}`, ...args], { encoding: 'utf8' }).trim()
const reset = () => execFileSync('php', [path.join(LAB_SCRIPTS, 'lab-reset.php'), LAB_WP_DIR, LAB_DIR, LAB_WP, CONNECTOR], { stdio: 'inherit' })

/** Etc/GMT-zone waarin het nu 02:xx is (let op: Etc/GMT-3 = UTC+3). */
function nightZone(): string {
  const offset = ((2 - new Date().getUTCHours() + 36) % 24) - 12
  return offset === 0 ? 'Etc/GMT' : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`
}
const TZ = nightZone()

test.describe.configure({ mode: 'serial' })
test.setTimeout(10 * 60_000)
test.use({ timezoneId: TZ })

test.beforeAll(() => {
  reset()
  // Alleen de twee updates van dit scenario: een gewone (footer) en een grote versiesprong (extra 0.9.0 → 1.1.0).
  for (const slug of ['vp-lab-fatal', 'vp-lab-prod-only', 'vp-lab-licensed', 'vp-lab-nopkg-addon', 'vp-lab-nopkg', 'vp-lab-formbreak', 'vp-lab-slider']) {
    wp('plugin', 'deactivate', slug)
    wp('plugin', 'delete', slug)
  }
  const file = path.join(LAB_WP_DIR, 'wp-content/plugins/vp-lab-extra/vp-lab-extra.php')
  execFileSync('sed', ['-i', 's/^ \\* Version: .*/ * Version: 0.9.0/', file])
  wp('transient', 'delete', '--all', '--network')
  wp('transient', 'delete', '--all')
})
test.afterAll(() => reset())

async function runs(siteId: string) {
  const c = db(); await c.connect()
  try {
    const { rows } = await c.query(`select id, trigger, status, verdict, created_by is null by_verploy, items from public.update_runs where site_id = $1 order by created_at`, [siteId])
    return rows as Array<{ id: string; trigger: string; status: string; verdict: string | null; by_verploy: boolean; items: Array<{ slug: string; to_version: string }> }>
  } finally { await c.end() }
}

test('aan → gewone update gaat vanzelf live, grote sprong wacht op akkoord, akkoord → live', async ({ page, context }) => {
  await signupWithAgency(page, owner, `Gepland ${run}`)
  const siteId = await addAndPairWordPress(page, context, 'Lab-WordPress', LAB_WP)
  await page.goto(`/sites/${siteId}`)
  await expect(page.getByText(/Verploy Lab — vp-lab-extra/).first()).toBeVisible()
  await expect(page.getByText('Plugin · 0.9.0 → 1.1.0')).toBeVisible()
  // Nog uit: geen blok op de sitepagina, en Verploy doet niets.
  await expect(page.getByText(/Automatisch bijgewerkt/)).toHaveCount(0)

  // Instellingen: Aan, moment Nacht. Standaard staat alles al goed; alleen aanzetten.
  await page.goto('/settings')
  const section = page.locator('#auto-updates')
  await expect(section.getByRole('heading', { name: 'Automatische veilige updates' })).toBeVisible()
  await section.getByRole('radio', { name: /^Aan/ }).check()
  await expect(section.getByLabel('Moment')).toHaveValue('night')
  await expect(section.getByText(`Tijden in jouw tijdzone (${TZ}).`)).toBeVisible()
  await section.getByRole('button', { name: 'Opslaan' }).click()
  await expect(section.getByText('Opgeslagen.')).toBeVisible()

  // Verploy start zelf de geplande veilige update — alleen met de gewone update.
  await expect.poll(async () => (await runs(siteId)).length, { timeout: 60_000 }).toBe(1)
  const [scheduled] = await runs(siteId)
  expect(scheduled).toMatchObject({ trigger: 'scheduled', by_verploy: true })
  expect(scheduled!.items.map(i => `${i.slug}@${i.to_version}`)).toEqual(['vp-lab-footer/vp-lab-footer.php@1.1.0'])
  await page.goto(`/sites/${siteId}/runs/${scheduled!.id}`)
  await expect(page.getByText('Automatisch gestart door Verploy (geplande veilige update).')).toBeVisible()
  await expect(page.locator('main').getByText('Live gezet', { exact: true }).first()).toBeVisible({ timeout: 6 * 60_000 })
  expect(wp('plugin', 'get', 'vp-lab-footer', '--field=version')).toBe('1.1.0')
  expect(wp('plugin', 'get', 'vp-lab-extra', '--field=version')).toBe('0.9.0')      // grote sprong: niet zelf gedaan

  // Afgelopen 24 uur op het overzicht: de run, met "gepland".
  await page.goto('/')
  await expect(page.getByText(/\(gepland\)/).first()).toBeVisible()

  // Inbox: één vraag om akkoord voor de grote versiesprong, met de website erbij.
  await page.goto('/inbox')
  const question = page.getByRole('listitem').filter({ hasText: 'Update wacht op je akkoord: Verploy Lab — vp-lab-extra 1.1.0' })
  await expect(question).toBeVisible()
  await expect(question.getByRole('link', { name: 'Lab-WordPress' })).toBeVisible()
  await expect(question.getByText('Beslissing', { exact: false })).toBeVisible()

  // Geen tweede geplande run in hetzelfde venster (de scheduler draait intussen elke paar seconden).
  await page.waitForTimeout(8_000)
  expect((await runs(siteId)).filter(r => r.trigger === 'scheduled')).toHaveLength(1)

  // Akkoord → gewone veilige update met precies dat onderdeel → live; de vraag vervalt.
  await question.getByRole('button', { name: 'Veilig uitvoeren' }).click()
  await expect(page.getByText('1 veilige update gestart.').first()).toBeVisible()
  const approved = (await runs(siteId)).at(-1)!
  expect(approved).toMatchObject({ trigger: 'manual', by_verploy: false })
  expect(approved.items.map(i => i.slug)).toEqual(['vp-lab-extra/vp-lab-extra.php'])
  await page.goto(`/sites/${siteId}/runs/${approved.id}`)
  await expect(page.locator('main').getByText('Live gezet', { exact: true }).first()).toBeVisible({ timeout: 6 * 60_000 })
  expect(wp('plugin', 'get', 'vp-lab-extra', '--field=version')).toBe('1.1.0')
  await expect.poll(async () => { await page.goto('/inbox'); return page.getByText(/wacht op je akkoord/).count() }, { timeout: 60_000 }).toBe(0)
})

test('per site "Nooit automatisch": de site doet niet meer mee', async ({ page }) => {
  const { login } = await import('./support/flows')
  await login(page, owner)
  await page.goto('/sites')
  await page.getByRole('link', { name: 'Lab-WordPress' }).first().click()
  const block = page.getByRole('region', { name: /Automatisch bijgewerkt: 's nachts, elke dag/ })
  await expect(block).toBeVisible()
  await block.getByRole('button', { name: 'Nooit automatisch' }).click()
  await expect(page.getByRole('region', { name: 'Deze site wordt nooit automatisch bijgewerkt' })).toBeVisible()
  await page.getByRole('region', { name: 'Deze site wordt nooit automatisch bijgewerkt' }).getByRole('button', { name: 'Weer automatisch' }).click()
  await expect(page.getByRole('region', { name: /Automatisch bijgewerkt/ })).toBeVisible()
})
