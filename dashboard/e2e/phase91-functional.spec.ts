import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { LAB_DIR, LAB_WP, LAB_WP_DIR, db } from './support/env'
import { addAndPairWordPress, login, signupWithAgency } from './support/flows'

/**
 * Functionele tests op de testkopie, met de ECHTE plugins (officiële zips van wordpress.org):
 * Contact Form 7, WPForms Lite en WooCommerce op de lab-WordPress (MySQL).
 *  1. onschuldige update → formulieren versturen en webwinkel t/m afrekenen werken vóór én na → live
 *  2. vp-lab-formbreak 1.1.0 laat CF7-verzending mislukken; de pagina ziet er hetzelfde uit → alleen de
 *     functionele test ziet het → tegengehouden, niets live, met de reden in gewone taal
 * Zonder de zips (E2E_FUNCTIONAL_ZIPS) wordt deze spec expliciet overgeslagen.
 */
const ZIPS = process.env.E2E_FUNCTIONAL_ZIPS ?? '/home/claude/wptest/functional-zips'
const hasZips = ['contact-form-7', 'wpforms-lite', 'woocommerce'].every(z => fs.existsSync(path.join(ZIPS, `${z}.zip`)))
const LAB_SCRIPTS = path.resolve(import.meta.dirname, '../../connector-plugin/tests/lab')
const CONNECTOR = path.resolve(import.meta.dirname, '../../connector-plugin/verploy-connector')

const run = Date.now().toString(36)
const owner = { email: `functioneel-${run}@example.test`, password: 'correct-horse-battery' }
let siteId = ''

test.describe.configure({ mode: 'serial' })
test.setTimeout(10 * 60_000)
test.skip(!hasZips, `plugin-zips ontbreken in ${ZIPS}`)

const reset = () => execFileSync('php', [path.join(LAB_SCRIPTS, 'lab-reset.php'), LAB_WP_DIR, LAB_DIR, LAB_WP, CONNECTOR], { stdio: 'inherit' })

test.beforeAll(() => {
  reset()
  execFileSync('php', ['-d', 'max_execution_time=0', path.join(LAB_SCRIPTS, 'functional-setup.php'), LAB_WP_DIR, LAB_WP, ZIPS], { stdio: 'inherit', timeout: 300_000 })
})
test.afterAll(() => { if (hasZips) reset() })
test.beforeEach(async ({ page }) => { if (siteId) await login(page, owner) })

async function startUpdate(page: Page, plugin: string) {
  await page.goto(`/sites/${siteId}`)
  for (const box of await page.getByRole('checkbox').all()) {
    const name = (await box.getAttribute('value')) ?? ''
    if (name.startsWith(`plugin:${plugin}/`)) await box.check()
    else await box.uncheck()
  }
  await page.getByRole('button', { name: '1 update veilig uitvoeren' }).click()
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/runs/[0-9a-f-]{36}`))
}

async function functionalRows(runId: string) {
  const c = db(); await c.connect()
  try {
    const { rows } = await c.query(`select phase, page_key, facts->>'outcome' outcome, facts->>'reason' reason from public.test_results
                                     where run_id = $1 and page_key like 'fn:%' order by page_key, phase`, [runId])
    return rows as Array<{ phase: string; page_key: string; outcome: string; reason: string }>
  } finally { await c.end() }
}

test('onschuldige update: formulieren versturen en webwinkel werken vóór én na — live gezet', async ({ page, context }) => {
  await signupWithAgency(page, owner, `Functioneel ${run}`)
  siteId = await addAndPairWordPress(page, context, 'Lab-WordPress', LAB_WP)
  await startUpdate(page, 'vp-lab-footer')
  const runId = page.url().match(/runs\/([0-9a-f-]{36})/)![1]!
  await expect(page.locator('main').getByText('Live gezet', { exact: true }).first()).toBeVisible({ timeout: 8 * 60_000 })

  const section = page.getByRole('region', { name: 'Functionele tests op de testkopie' })
  await expect(section).toBeVisible()
  for (const kind of ['Formulier (Contact Form 7)', 'Formulier (WPForms)', 'Webwinkel: product → winkelwagen → afrekenen']) {
    const row = section.getByRole('row').filter({ hasText: kind })
    await expect(row.getByText('Werkt', { exact: true })).toHaveCount(2)                   // vóór en na
  }
  await expect(section.getByText('verstuurd, bevestiging getoond').first()).toBeVisible()
  await expect(section.getByText('afrekenpagina bereikt').first()).toBeVisible()
  await expect(page.getByText(/Functionele nulmeting: 3 van 3 tests werken/)).toBeVisible()

  const rows = await functionalRows(runId)
  expect(rows.filter(r => r.phase === 'staging_before').map(r => r.outcome)).toEqual(['ok', 'ok', 'ok'])
  expect(rows.filter(r => r.phase === 'staging_after').map(r => r.outcome)).toEqual(['ok', 'ok', 'ok'])
  // Alles gebeurde op de testkopie: op de live site is niets besteld.
  const live = execFileSync('php', ['/home/claude/tools/wp-cli.phar', '--allow-root', `--path=${LAB_WP_DIR}`, 'eval',
    'echo count( wc_get_orders( array( "limit" => -1 ) ) );'], { encoding: 'utf8' }).trim()
  expect(live).toBe('0')
})

test('update die formulieren breekt (pagina ziet er hetzelfde uit) → tegengehouden door de functionele test', async ({ page }) => {
  await startUpdate(page, 'vp-lab-formbreak')
  const runId = page.url().match(/runs\/([0-9a-f-]{36})/)![1]!
  await expect(page.locator('main').getByText('Tegengehouden', { exact: true }).first()).toBeVisible({ timeout: 8 * 60_000 })
  await expect(page.getByRole('heading', { name: 'Niets live gezet' })).toBeVisible()
  await expect(page.getByText('Formulier op Contact werkt niet meer na de update: versturen mislukt.').first()).toBeVisible()
  await expect(page.getByText('Je live site is niet gewijzigd.')).toBeVisible()

  const rows = await functionalRows(runId)
  const cf7 = rows.filter(r => r.page_key.endsWith(':cf7'))
  expect(cf7.map(r => [r.phase, r.outcome, r.reason])).toEqual([['staging_after', 'failed', 'submit_failed'], ['staging_before', 'ok', 'sent']])
  // Andere formulieren en de winkel werkten nog: alleen CF7 is het probleem.
  expect(rows.filter(r => r.phase === 'staging_after' && !r.page_key.endsWith(':cf7')).map(r => r.outcome)).toEqual(['ok', 'ok'])

  const version = execFileSync('php', ['/home/claude/tools/wp-cli.phar', '--allow-root', `--path=${LAB_WP_DIR}`, 'plugin', 'get', 'vp-lab-formbreak', '--field=version'], { encoding: 'utf8' }).trim()
  expect(version).toBe('1.0.0')
})
