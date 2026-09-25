import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { LAB_DIR, LAB_WP, LAB_WP_DIR, db } from './support/env'
import { addAndPairWordPress, signupWithAgency } from './support/flows'

/**
 * Echte sliders (Slider Revolution, Swiper, …) wisselen van dia; dat mag een onschuldige update nooit
 * tegenhouden of laten terugdraaien (zo ging het bij Feel Good TentEvent). Verploy dekt bekende
 * sliders en carrousels in elke screenshot af, maar controleert wel of ze er na de update nog staan.
 *   1. Swiper met bij elke lading een andere dia + onschuldige update → live gezet, geen verschil.
 *   2. Dezelfde update laat de slider verdwijnen → tegengehouden ("slider of carrousel is verdwenen").
 */
const LAB_SCRIPTS = path.resolve(import.meta.dirname, '../../connector-plugin/tests/lab')
const CONNECTOR = path.resolve(import.meta.dirname, '../../connector-plugin/verploy-connector')
const MU = path.join(LAB_WP_DIR, 'wp-content/mu-plugins/vp-lab-swiper.php')
const run = Date.now().toString(36)
const wp = (...args: string[]) => execFileSync('php', ['/home/claude/tools/wp-cli.phar', '--allow-root', `--path=${LAB_WP_DIR}`, ...args], { encoding: 'utf8' }).trim()
const reset = () => execFileSync('php', [path.join(LAB_SCRIPTS, 'lab-reset.php'), LAB_WP_DIR, LAB_DIR, LAB_WP, CONNECTOR], { stdio: 'inherit' })

// Een slider zoals Swiper die maakt, 420px hoog, met bij elke lading een andere dia.
// Optie 'breaks': na vp-lab-footer 1.1.0 is de slider weg (zoals een update die een slider-plugin breekt).
const SWIPER = `<?php
add_action( 'wp_body_open', function () {
	$mode = get_option( 'vp_lab_swiper' );
	if ( ! $mode ) { return; }
	if ( 'breaks' === $mode ) {
		if ( ! function_exists( 'get_plugin_data' ) ) { require_once ABSPATH . 'wp-admin/includes/plugin.php'; }
		$d = get_plugin_data( WP_PLUGIN_DIR . '/vp-lab-footer/vp-lab-footer.php', false, false );
		if ( version_compare( $d['Version'], '1.1.0', '>=' ) ) { return; }
	}
	printf( '<div class="swiper swiper-initialized" style="height:420px"><div class="swiper-wrapper"><div class="swiper-slide" style="height:420px;background:hsl(%d,70%%,50%%)"></div></div></div>', mt_rand( 0, 359 ) );
} );
`

test.describe.configure({ mode: 'serial' })
test.setTimeout(8 * 60_000)
test.beforeEach(() => { reset(); fs.mkdirSync(path.dirname(MU), { recursive: true }); fs.writeFileSync(MU, SWIPER) })
test.afterAll(() => { fs.rmSync(MU, { force: true }); reset() })

async function updateFooter(page: Page, siteId: string): Promise<string> {
  await page.goto(`/sites/${siteId}`)
  for (const box of await page.getByRole('checkbox').all()) {
    if (((await box.getAttribute('value')) ?? '').startsWith('plugin:vp-lab-footer/')) await box.check()
    else await box.uncheck()
  }
  await page.getByRole('button', { name: '1 update veilig uitvoeren' }).click()
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/runs/[0-9a-f-]{36}`))
  return page.url().match(/runs\/([0-9a-f-]{36})/)![1]!
}

test('slider met wisselende dia + onschuldige update → afgedekt, live gezet', async ({ page, context }) => {
  wp('option', 'update', 'vp_lab_swiper', 'on')
  await signupWithAgency(page, { email: `slider-${run}@example.test`, password: 'correct-horse-battery' }, `Slider ${run}`)
  const siteId = await addAndPairWordPress(page, context, 'Lab-WordPress', LAB_WP)
  const runId = await updateFooter(page, siteId)
  await expect(page.locator('main').getByText('Live gezet', { exact: true }).first()).toBeVisible({ timeout: 6 * 60_000 })
  expect(wp('plugin', 'get', 'vp-lab-footer', '--field=version')).toBe('1.1.0')

  const c = db(); await c.connect()
  try {
    const { rows } = await c.query(`select phase, viewport, diff_ratio, passed, facts->>'moving' moving from public.test_results
                                     where run_id = $1 and page_key = 'home' and phase in ('staging_after', 'production_after')`, [runId])
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.passed).toBe(true)
      expect(Number(r.diff_ratio)).toBeLessThanOrEqual(0.02)
      expect(Number(r.moving)).toBeGreaterThanOrEqual(400)          // de slider is gemeten (en afgedekt)
    }
  } finally { await c.end() }
})

test('update laat de slider verdwijnen → tegengehouden met een duidelijke reden', async ({ page, context }) => {
  wp('option', 'update', 'vp_lab_swiper', 'breaks')
  await signupWithAgency(page, { email: `slider-weg-${run}@example.test`, password: 'correct-horse-battery' }, `Slider weg ${run}`)
  const siteId = await addAndPairWordPress(page, context, 'Lab-WordPress', LAB_WP)
  await updateFooter(page, siteId)
  await expect(page.locator('main').getByText('Tegengehouden', { exact: true }).first()).toBeVisible({ timeout: 6 * 60_000 })
  await expect(page.getByText(/een slider of carrousel is verdwenen of ingeklapt/).first()).toBeVisible()
  expect(wp('plugin', 'get', 'vp-lab-footer', '--field=version')).toBe('1.0.0')    // live site onaangeroerd
})
