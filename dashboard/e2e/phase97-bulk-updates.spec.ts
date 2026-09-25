import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { LAB_DIR, LAB_WP, LAB_WP_DIR, db } from './support/env'
import { addAndPairWordPress, signupWithAgency } from './support/flows'

/**
 * Updates op al je sites: per onderdeel één regel met één knop. Een klik start per site een gewone veilige
 * update voor precies dat onderdeel (testkopie → live).
 */
const LAB_SCRIPTS = path.resolve(import.meta.dirname, '../../connector-plugin/tests/lab')
const CONNECTOR = path.resolve(import.meta.dirname, '../../connector-plugin/verploy-connector')
const run = Date.now().toString(36)
const owner = { email: `alles-${run}@example.test`, password: 'correct-horse-battery' }
const wp = (...args: string[]) => execFileSync('php', ['/home/claude/tools/wp-cli.phar', '--allow-root', `--path=${LAB_WP_DIR}`, ...args], { encoding: 'utf8' }).trim()
const reset = () => execFileSync('php', [path.join(LAB_SCRIPTS, 'lab-reset.php'), LAB_WP_DIR, LAB_DIR, LAB_WP, CONNECTOR], { stdio: 'inherit' })

test.setTimeout(8 * 60_000)
test.beforeAll(() => reset())
test.afterAll(() => reset())

test('één knop per onderdeel: veilige update gestart voor precies dat onderdeel, daarna live', async ({ page, context }) => {
  await signupWithAgency(page, owner, `Alles ${run}`)
  const siteId = await addAndPairWordPress(page, context, 'Lab-WordPress', LAB_WP)

  await page.getByRole('navigation', { name: 'Hoofdmenu' }).getByRole('link', { name: 'Updates' }).click()
  await expect(page.getByRole('heading', { name: 'Updates op al je sites' })).toBeVisible()
  const row = page.getByRole('listitem').filter({ hasText: 'Verploy Lab — vp-lab-footer' }).first()
  await expect(row.getByText('→ 1.1.0', { exact: true })).toBeVisible()
  await expect(row.getByText('1 site', { exact: false }).first()).toBeVisible()
  await row.getByText('Welke sites').click()
  await expect(row.getByRole('link', { name: 'Lab-WordPress' })).toHaveAttribute('href', `/sites/${siteId}#updates`)

  await row.getByRole('button', { name: 'Veilig bijwerken op 1 site' }).click()
  await expect(row.getByText('1 veilige update gestart.')).toBeVisible()

  const c = db(); await c.connect()
  let runId = ''
  try {
    const { rows } = await c.query(`select id, items from public.update_runs where site_id = $1`, [siteId])
    expect(rows).toHaveLength(1)
    expect((rows[0].items as Array<{ slug: string }>).map(i => i.slug)).toEqual(['vp-lab-footer/vp-lab-footer.php'])
    runId = rows[0].id
  } finally { await c.end() }
  await page.goto(`/sites/${siteId}/runs/${runId}`)
  await expect(page.locator('main').getByText('Live gezet', { exact: true }).first()).toBeVisible({ timeout: 6 * 60_000 })
  expect(wp('plugin', 'get', 'vp-lab-footer', '--field=version')).toBe('1.1.0')

  // Bijgewerkt: het onderdeel staat niet meer in de lijst.
  await expect.poll(async () => { await page.goto('/updates'); return page.getByRole('listitem').filter({ hasText: 'Verploy Lab — vp-lab-footer' }).count() }, { timeout: 60_000 }).toBe(0)
})
