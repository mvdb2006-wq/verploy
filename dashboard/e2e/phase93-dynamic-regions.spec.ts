import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { LAB_DIR, LAB_WP, LAB_WP_DIR, db } from './support/env'
import { addAndPairWordPress, signupWithAgency } from './support/flows'

/**
 * Bewegende delen (slider, achtergrondvideo, wisselende foto's) mogen een onschuldige update niet
 * tegenhouden. vp-lab-slider zet bovenaan elke pagina een grote banner die bij elke lading een andere
 * kleur heeft (zoals Feel Good TentEvent met zijn wisselende headerfoto). De update van vp-lab-footer
 * verandert alleen een regel tekst in de footer.
 *   → Verploy laadt de pagina opnieuw, ziet dat de banner vanzelf beweegt, negeert die en zet live.
 */
const LAB_SCRIPTS = path.resolve(import.meta.dirname, '../../connector-plugin/tests/lab')
const CONNECTOR = path.resolve(import.meta.dirname, '../../connector-plugin/verploy-connector')
const run = Date.now().toString(36)
const owner = { email: `beweging-${run}@example.test`, password: 'correct-horse-battery' }
const wp = (...args: string[]) => execFileSync('php', ['/home/claude/tools/wp-cli.phar', '--allow-root', `--path=${LAB_WP_DIR}`, ...args], { encoding: 'utf8' }).trim()
const reset = () => execFileSync('php', [path.join(LAB_SCRIPTS, 'lab-reset.php'), LAB_WP_DIR, LAB_DIR, LAB_WP, CONNECTOR], { stdio: 'inherit' })

test.setTimeout(8 * 60_000)
test.beforeAll(() => { reset(); wp('option', 'update', 'vp_lab_slider', '1') })
test.afterAll(() => reset())

test('banner die bij elke lading anders is + onschuldige update → bewegend deel genegeerd, live gezet', async ({ page, context }) => {
  await signupWithAgency(page, owner, `Beweging ${run}`)
  const siteId = await addAndPairWordPress(page, context, 'Lab-WordPress', LAB_WP)

  // Voorwaarde: de banner verandert echt bij elke lading.
  const colour = async () => (await (await fetch(LAB_WP)).text()).match(/vp-lab-slider" style="height:240px;background:(hsl\([^)]*\))/)?.[1]
  const seen = new Set([await colour(), await colour(), await colour()])
  expect(seen.size).toBeGreaterThan(1)

  await page.goto(`/sites/${siteId}`)
  for (const box of await page.getByRole('checkbox').all()) {
    if (((await box.getAttribute('value')) ?? '').startsWith('plugin:vp-lab-footer/')) await box.check()
    else await box.uncheck()
  }
  await page.getByRole('button', { name: '1 update veilig uitvoeren' }).click()
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/runs/[0-9a-f-]{36}`))
  const runId = page.url().match(/runs\/([0-9a-f-]{36})/)![1]!
  await expect(page.locator('main').getByText('Live gezet', { exact: true }).first()).toBeVisible({ timeout: 6 * 60_000 })
  expect(wp('plugin', 'get', 'vp-lab-footer', '--field=version')).toBe('1.1.0')

  // Zichtbaar waarom: het bewegende deel is blauw in het verschilbeeld en telt niet mee.
  const note = /Blauw in het verschilbeeld: delen die ook zonder update steeds veranderen/
  const home = page.locator('details').filter({ has: page.getByText(note) }).first()   // geslaagde pagina: ingeklapt
  await home.locator('summary').click()
  await expect(home.getByText(note).first()).toBeVisible()

  const c = db(); await c.connect()
  try {
    const { rows } = await c.query(`select phase, viewport, diff_ratio, passed, (select (x->'detail'->>'ignored')::float from jsonb_array_elements(checks) x where x->>'check' = 'visual') ignored
                                     from public.test_results where run_id = $1 and page_key = 'home' and phase in ('staging_after', 'production_after') order by phase, viewport`, [runId])
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.passed).toBe(true)
      expect(Number(r.diff_ratio)).toBeLessThanOrEqual(0.02)
    }
    // Minstens één vergelijking had de banner als bewegend deel herkend (de banner beslaat een flink deel van de pagina).
    expect(rows.some(r => (r.ignored ?? 0) > 0.05)).toBe(true)
  } finally { await c.end() }
})
