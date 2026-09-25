import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { LAB_DIR, LAB_WP, LAB_WP_DIR, db } from './support/env'
import { addAndPairWordPress, login, signupWithAgency } from './support/flows'

/**
 * Verploy werkt zijn eigen connector bij via een gewone veilige update (testkopie → tests → live),
 * zonder dat iemand in WP Admin hoeft in te loggen: 2.3.0 → de huidige release.
 * Zoals op een echte site komt de update-informatie uit de cache van de connector (bij een echte site
 * opgehaald van app.verploy.com); het pakket staat hier in de lab-repository.
 */
const OLD = process.env.E2E_OLD_CONNECTOR ?? '/home/claude/wptest/connector-2.3.0/connector-plugin/verploy-connector'
const LAB_REPO = process.env.E2E_LAB_REPO_URL ?? 'http://127.0.0.1:8090'
const CURRENT = path.resolve(import.meta.dirname, '../../connector-plugin/verploy-connector')
const RELEASE = fs.readFileSync(path.join(CURRENT, 'verploy-connector.php'), 'utf8').match(/Version:\s*([0-9.]+)/)![1]!
const ZIP = path.resolve(import.meta.dirname, `../public/downloads/verploy-connector-${RELEASE}.zip`)
const LAB_SCRIPTS = path.resolve(import.meta.dirname, '../../connector-plugin/tests/lab')
const WPCLI = process.env.E2E_WPCLI ?? '/home/claude/tools/wp-cli.phar'

const run = Date.now().toString(36)
const owner = { email: `zelfupdate-${run}@example.test`, password: 'correct-horse-battery' }
let siteId = ''

test.describe.configure({ mode: 'serial' })
test.setTimeout(10 * 60_000)
test.skip(!fs.existsSync(OLD), `oude connector ontbreekt in ${OLD}`)

const wp = (...args: string[]) => execFileSync('php', [WPCLI, '--allow-root', `--path=${LAB_WP_DIR}`, ...args], { encoding: 'utf8' }).trim()

test.beforeAll(() => {
  execFileSync('php', [path.join(LAB_SCRIPTS, 'lab-reset.php'), LAB_WP_DIR, LAB_DIR, LAB_WP, OLD], { stdio: 'inherit' })
  fs.copyFileSync(ZIP, path.join(LAB_DIR, 'repo', path.basename(ZIP)))
  // Zoals WordPress' eigen updatecontrole (de lab kan wordpress.org niet bereiken): de lijst met geïnstalleerde
  // versies opslaan, waarbij de connector zelf (filter pre_set_site_transient_update_plugins) zijn update toevoegt.
  wp('eval', `require_once ABSPATH . 'wp-admin/includes/plugin.php';
    set_transient( 'verploy_update_info', array( 'version' => '${RELEASE}', 'download_url' => '${LAB_REPO}/${path.basename(ZIP)}', 'details_url' => 'https://verploy.com' ), HOUR_IN_SECONDS );
    $t = new stdClass(); $t->last_checked = time(); $t->response = array(); $t->checked = array();
    foreach ( get_plugins() as $file => $data ) { $t->checked[ $file ] = $data['Version']; }
    set_site_transient( 'update_plugins', $t );`)
})
test.afterAll(() => {
  execFileSync('php', [path.join(LAB_SCRIPTS, 'lab-reset.php'), LAB_WP_DIR, LAB_DIR, LAB_WP, CURRENT], { stdio: 'inherit' })
})
test.beforeEach(async ({ page }) => { if (siteId) await login(page, owner) })

test(`Verploy Connector 2.3.0 → ${RELEASE} via een veilige update`, async ({ page, context }) => {
  expect(wp('plugin', 'get', 'verploy-connector', '--field=version')).toBe('2.3.0')
  await signupWithAgency(page, owner, `Zelfupdate ${run}`)
  siteId = await addAndPairWordPress(page, context, 'Lab-WordPress', LAB_WP)
  await page.reload()
  // Oudere connector: bij de versie staat een downloadlink naar de nieuwste zip, en een verwijzing naar veilig bijwerken.
  const download = page.getByRole('link', { name: `${RELEASE} downloaden` })
  await expect(download).toHaveAttribute('href', '/api/v1/plugin/download')
  const zip = await page.request.get('/api/v1/plugin/download')
  expect(zip.status()).toBe(200)
  expect(zip.headers()['content-disposition']).toContain(`verploy-connector-${RELEASE}.zip`)
  await expect(page.getByRole('link', { name: 'of veilig bijwerken' })).toHaveAttribute('href', '#updates')
  const box = page.getByRole('checkbox', { name: /Verploy Connector/ })
  await expect(box).toBeVisible()
  for (const b of await page.getByRole('checkbox').all()) {
    if (((await b.getAttribute('value')) ?? '').startsWith('plugin:verploy-connector/')) await b.check()
    else await b.uncheck()
  }
  await page.getByRole('button', { name: '1 update veilig uitvoeren' }).click()
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/runs/[0-9a-f-]{36}`))
  await expect(page.locator('main').getByText('Live gezet', { exact: true }).first()).toBeVisible({ timeout: 8 * 60_000 })
  expect(wp('plugin', 'get', 'verploy-connector', '--field=version')).toBe(RELEASE)
  // De nieuwe connector stuurt meteen een heartbeat: het dashboard kent de nieuwe versie.
  await expect.poll(async () => {
    const c = db(); await c.connect()
    try { return (await c.query(`select connector_version from public.sites where id = $1`, [siteId])).rows[0].connector_version } finally { await c.end() }
  }, { timeout: 30_000 }).toBe(RELEASE)
  expect((await fetch(`${LAB_WP}/`)).status).toBe(200)
})
