import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { LAB_DIR, LAB_WP, LAB_WP_DIR, db } from './support/env'
import { addAndPairWordPress, signupWithAgency } from './support/flows'

/**
 * "Inloggen in WP Admin" met één klik (connector 2.5), zonder wachtwoord:
 *   sitepagina → knop → nieuw tabblad → ingelogd in WP Admin als de beheerder van de site;
 *   de login staat in Verploy én op de site (Instellingen → Verploy);
 *   de site-eigenaar zet het uit in WordPress → de knop wordt weer een gewone link naar het inlogscherm.
 */
const LAB_SCRIPTS = path.resolve(import.meta.dirname, '../../connector-plugin/tests/lab')
const CONNECTOR = path.resolve(import.meta.dirname, '../../connector-plugin/verploy-connector')
const run = Date.now().toString(36)
const owner = { email: `wplogin-${run}@example.test`, password: 'correct-horse-battery' }
const wp = (...args: string[]) => execFileSync('php', ['/home/claude/tools/wp-cli.phar', '--allow-root', `--path=${LAB_WP_DIR}`, ...args], { encoding: 'utf8' }).trim()
const reset = () => execFileSync('php', [path.join(LAB_SCRIPTS, 'lab-reset.php'), LAB_WP_DIR, LAB_DIR, LAB_WP, CONNECTOR], { stdio: 'inherit' })

test.describe.configure({ mode: 'serial' })
test.setTimeout(4 * 60_000)
test.beforeAll(() => reset())
test.afterAll(() => { wp('option', 'delete', 'verploy_sso_enabled'); reset() })

test('één klik: ingelogd in WP Admin als de beheerder, vastgelegd in Verploy en op de site; uitzetten op de site werkt', async ({ page, context }) => {
  await signupWithAgency(page, owner, `WP-login ${run}`)
  const siteId = await addAndPairWordPress(page, context, 'Lab-WordPress', LAB_WP)
  const adminLogin = wp('user', 'get', '1', '--field=user_login')

  await page.goto(`/sites/${siteId}`)
  const button = page.getByRole('button', { name: 'Inloggen in WP Admin' })
  await expect(button).toBeVisible()
  // Uitloggen uit WordPress (het koppelen gebeurde in dezelfde browser); Verploy-sessie blijft.
  await context.clearCookies({ name: /^wordpress/ })
  expect((await context.cookies()).some(c => c.name.startsWith('wordpress_logged_in'))).toBe(false)
  const [wpPage] = await Promise.all([context.waitForEvent('page'), button.click()])
  await wpPage.waitForURL(`${LAB_WP}/wp-admin/`, { timeout: 30_000 })
  await expect(wpPage.locator('#wpadminbar')).toBeVisible()
  await expect(wpPage.locator('#wp-admin-bar-my-account')).toContainText(wp('user', 'get', '1', '--field=display_name'))
  await wpPage.close()

  // In Verploy: wie, als welke beheerder.
  const c = db(); await c.connect()
  try {
    const { rows } = await c.query(`select user_email, wp_user_id, wp_user_login from public.wp_logins where site_id = $1`, [siteId])
    expect(rows).toEqual([{ user_email: owner.email, wp_user_id: 1, wp_user_login: adminLogin }])
  } finally { await c.end() }
  await page.reload()
  await page.getByText('Inloggen in WP Admin', { exact: true }).last().click()          // het uitklapblok
  await expect(page.getByText(new RegExp(`${owner.email.replace(/[.]/g, '\\.')} als ${adminLogin}`))).toBeVisible()

  // Op de site: het logboek onder Instellingen → Verploy.
  const log = wp('option', 'get', 'verploy_sso_log', '--format=json')
  expect(JSON.parse(log)[0]).toMatchObject({ by: owner.email, user: adminLogin })

  // De site-eigenaar zet het uit → na de volgende heartbeat is de knop weer een gewone link.
  wp('option', 'update', 'verploy_sso_enabled', '0')
  wp('eval', 'Verploy_Heartbeat::send();')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Inloggen in WP Admin' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'WP Admin' }).first()).toHaveAttribute('href', `${LAB_WP}/wp-admin/`)
})
