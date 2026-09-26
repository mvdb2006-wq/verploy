import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { LAB_DIR, LAB_WP, LAB_WP_DIR, db } from './support/env'
import { addAndPairWordPress, signupWithAgency } from './support/flows'

/**
 * Fotogalerij met lazy loading (zoals Zeelte Transport en Visgilde): de echte foto staat in data-src en
 * wordt pas na het scrollen, met een willekeurige vertraging, geladen. Zonder ingreep mist de ene meting
 * foto's die de andere wel heeft, en werd een onschuldige update teruggedraaid.
 *   → Verploy laadt de foto's zelf in en wacht tot de galerij stilstaat: geen verschil, live gezet.
 */
const LAB_SCRIPTS = path.resolve(import.meta.dirname, '../../connector-plugin/tests/lab')
const CONNECTOR = path.resolve(import.meta.dirname, '../../connector-plugin/verploy-connector')
const MU = path.join(LAB_WP_DIR, 'wp-content/mu-plugins/vp-lab-gallery.php')
const IMG_DIR = path.join(LAB_WP_DIR, 'wp-content/uploads/vp-lab-gallery')
const run = Date.now().toString(36)
const wp = (...args: string[]) => execFileSync('php', ['/home/claude/tools/wp-cli.phar', '--allow-root', `--path=${LAB_WP_DIR}`, ...args], { encoding: 'utf8' }).trim()
const reset = () => execFileSync('php', [path.join(LAB_SCRIPTS, 'lab-reset.php'), LAB_WP_DIR, LAB_DIR, LAB_WP, CONNECTOR], { stdio: 'inherit' })

// 18 foto's in een raster van 3 kolommen; placeholder is een lege gif, de echte foto komt na het scrollen
// met 0–900 ms vertraging (zoals lazysizes bij een trage server).
const GALLERY = `<?php
add_action( 'wp_body_open', function () {
	echo '<div class="vp-lab-gallery" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:8px">';
	for ( $i = 1; $i <= 18; $i++ ) {
		printf( '<img class="lazyload" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="%s" width="400" height="300" style="width:100%%;height:auto;background:#eee">', esc_url( content_url( "uploads/vp-lab-gallery/$i.png" ) ) );
	}
	echo '</div><script>
	function vpLoad(){document.querySelectorAll("img.lazyload").forEach(function(img){var r=img.getBoundingClientRect();if(r.top<innerHeight){img.classList.remove("lazyload");setTimeout(function(){img.src=img.dataset.src},Math.random()*900)}})}
	addEventListener("scroll",vpLoad);addEventListener("load",vpLoad);
	</script>';
} );
`

test.setTimeout(8 * 60_000)
test.beforeAll(() => {
  reset()
  fs.mkdirSync(IMG_DIR, { recursive: true })
  // Echte (verschillende) foto's maken met GD.
  execFileSync('php', ['-r', `for ($i = 1; $i <= 18; $i++) { $im = imagecreatetruecolor(400, 300); imagefill($im, 0, 0, imagecolorallocate($im, ($i * 37) % 255, ($i * 71) % 255, ($i * 113) % 255)); imagestring($im, 5, 20, 20, "foto $i", imagecolorallocate($im, 255, 255, 255)); imagepng($im, ${JSON.stringify(IMG_DIR)} . "/$i.png"); }`])
  fs.mkdirSync(path.dirname(MU), { recursive: true })
  fs.writeFileSync(MU, GALLERY)
})
test.afterAll(() => { fs.rmSync(MU, { force: true }); fs.rmSync(IMG_DIR, { recursive: true, force: true }); reset() })

test('lazy-loaded fotogalerij + onschuldige update → geen verschil, live gezet', async ({ page, context }) => {
  await signupWithAgency(page, { email: `galerij-${run}@example.test`, password: 'correct-horse-battery' }, `Galerij ${run}`)
  const siteId = await addAndPairWordPress(page, context, 'Lab-WordPress', LAB_WP)
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

  const c = db(); await c.connect()
  try {
    const { rows } = await c.query(`select phase, viewport, diff_ratio, passed from public.test_results
                                     where run_id = $1 and page_key = 'home' and phase in ('staging_after', 'production_after')`, [runId])
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.passed).toBe(true)
      expect(Number(r.diff_ratio)).toBeLessThanOrEqual(0.02)        // alleen de gewijzigde footerregel; de galerij (≈45% van de pagina) is gelijk
    }
  } finally { await c.end() }
})
