import type { Browser, BrowserContext, Page } from 'playwright-core'

export type Viewport = 'desktop' | 'mobile'
export const VIEWPORTS: Record<Viewport, { width: number; height: number; isMobile: boolean; hasTouch: boolean }> = {
  desktop: { width: 1280, height: 800, isMobile: false, hasTouch: false },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
}

/** Maximale hoogte van een screenshot; langere pagina's worden afgekapt. */
export const MAX_SHOT_HEIGHT = 4000

export const LANDMARKS = {
  header: 'header, [role="banner"]',
  nav: 'nav, [role="navigation"]',
  main: 'main, [role="main"]',
  footer: 'footer, [role="contentinfo"]',
} as const
export type Landmark = keyof typeof LANDMARKS

/** Wat we van één pagina vastleggen. Vergelijken gebeurt later (compare.ts). */
export interface PageCapture {
  url: string
  status: number | null
  loadMs: number
  error: string | null
  phpError: string | null
  jsErrors: string[]
  failedResources: string[]
  landmarks: Landmark[]
  textLength: number
  title: string
  loginForm: boolean | null
  /** Totale zichtbare hoogte (px) van de bewegende blokken (AUTO_MASKS); om een verdwenen slider te zien. */
  moving?: number
  /** Thema-mappen waar de pagina bestanden uit laadt (actief thema én een eventueel parent-thema). */
  themes?: string[]
  screenshot: Buffer | null
}

// Meldingen van PHP en WordPress die op een kapotte pagina staan.
const PHP_ERROR_PATTERNS: [RegExp, string][] = [
  [/There has been a critical error on (this|your) website/i, 'wp_critical_error'],
  [/<b>(Fatal|Parse) error<\/b>|(Fatal|Parse) error:\s/i, 'php_fatal'],
  [/Error establishing a database connection/i, 'db_connection'],
  [/Briefly unavailable for scheduled maintenance/i, 'maintenance'],
]

export function detectPhpError(html: string): string | null {
  for (const [re, code] of PHP_ERROR_PATTERNS) if (re.test(html)) return code
  return null
}

/** Maakt foutmeldingen vergelijkbaar tussen omgevingen (URL's, regelnummers, cachebusters weg). */
export function normalizeJsError(message: string): string {
  return message
    .replace(/https?:\/\/[^\s)'"]+/g, '<url>')
    .replace(/:\d+:\d+/g, '')
    .replace(/\b\d{3,}\b/g, '<n>')
    .trim()
    .slice(0, 300)
}

/**
 * Delen die vanzelf veranderen (sliders, carrousels, video, kaarten, ingesloten video's). Die worden in
 * elke screenshot afgedekt: een andere dia vóór en na de update is geen fout. Of zo'n blok er na de
 * update nog staat (en niet is ingeklapt), controleert Verploy apart via de hoogte (`moving`).
 */
export const AUTO_MASKS = [
  // Slider Revolution, Master Slider, LayerSlider, Smart Slider, MetaSlider, Soliloquy
  'rs-module-wrap', 'sr7-module', '.rev_slider_wrapper', '.wpb_revslider_element', '.master-slider', '.ms-slider-wrapper',
  '.ls-wp-container', '.ls-container', '.n2-section-smartslider', '.metaslider', '.soliloquy-container',
  // Carrousel-bibliotheken
  '.swiper', '.swiper-container', '.swiper-initialized', '.wpcp-carousel-wrapper', '.slick-slider', '.owl-carousel', '.flexslider', '.splide', '.glide', '.flickity-enabled', '.carousel',
  // Paginabouwers
  '.elementor-slides-wrapper', '.elementor-image-carousel-wrapper', '.elementor-background-slideshow', '.elementor-background-video-container',
  '.vc_images_carousel', '.wpb_gallery_slides', '.vc_video-bg', '.et_pb_slider', '.fl-slideshow',
  // Media en ingesloten inhoud
  'video', 'iframe[src*="youtube"]', 'iframe[src*="youtu.be"]', 'iframe[src*="vimeo"]', 'iframe[src*="google.com/maps"]', 'iframe[src*="instagram"]',
]

const STABILIZE_CSS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}`

export interface CaptureOptions {
  masks: string[]
  /** Cookies die de worker toegang geven (staging-token of bypass tijdens onderhoud). */
  cookies: { name: string; value: string; url: string }[]
  screenshot: boolean
  timeoutMs?: number
}

export async function newContext(browser: Browser, viewport: Viewport, cookies: CaptureOptions['cookies']): Promise<BrowserContext> {
  const v = VIEWPORTS[viewport]
  const ctx = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    isMobile: v.isMobile,
    hasTouch: v.hasTouch,
    deviceScaleFactor: 1,
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    reducedMotion: 'reduce',
    ignoreHTTPSErrors: false,
    userAgent: `Mozilla/5.0 (${v.isMobile ? 'Linux; Android 14; Mobile' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Verploy-Check/1.0`,
  })
  // Alleen voor de eigen site (domein + pad /): tokens gaan nooit mee naar CDN's of andere domeinen.
  if (cookies.length) {
    await ctx.addCookies(cookies.map(c => {
      const u = new URL(c.url)
      return { name: c.name, value: c.value, domain: u.hostname, path: '/', httpOnly: true, secure: u.protocol === 'https:', sameSite: 'Lax' as const }
    }))
  }
  return ctx
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined)
  await page.addStyleTag({ content: STABILIZE_CSS }).catch(() => undefined)
  // Lazy-loaded afbeeldingen: alles in één keer laten laden, rustig naar beneden en terug scrollen, en dan
  // wachten tot elke afbeelding in beeld echt geladen is. Anders mist de ene screenshot een foto die de
  // andere wel heeft, en lijkt dat een verschil door de update.
  await page.evaluate(async (max) => {
    // Lazy-load-scripts (lazysizes, WP Rocket, Autoptimize, a3, Jetpack, …) zetten de echte afbeelding pas bij
    // het scrollen in src. Die zetten we zelf meteen, anders heeft de ene meting een foto die de andere mist.
    const pick = (el: Element, names: string[]) => names.map(n => el.getAttribute(n)).find(v => v && !v.startsWith('data:image/svg'))
    document.querySelectorAll('img').forEach(i => {
      const src = pick(i, ['data-lazy-src', 'data-src', 'data-original', 'data-lazy', 'data-orig-src'])
      const set = pick(i, ['data-lazy-srcset', 'data-srcset'])
      if (src && i.getAttribute('src') !== src) i.setAttribute('src', src)
      if (set) i.setAttribute('srcset', set)
      i.setAttribute('loading', 'eager')
      if (i.classList.contains('lazyload') || i.classList.contains('lazy')) { i.classList.remove('lazyload', 'lazy', 'lazyloading'); i.classList.add('lazyloaded', 'loaded') }
    })
    document.querySelectorAll('source[data-srcset]').forEach(s => s.setAttribute('srcset', s.getAttribute('data-srcset')!))
    document.querySelectorAll<HTMLElement>('[data-bg],[data-background-image],[data-bg-image]').forEach(e => {
      const bg = e.getAttribute('data-bg') || e.getAttribute('data-background-image') || e.getAttribute('data-bg-image')
      if (bg && !e.style.backgroundImage) e.style.backgroundImage = bg.startsWith('url(') ? bg : `url("${bg}")`
    })
    const step = Math.max(200, Math.round(window.innerHeight / 2))
    for (let y = 0; y < Math.min(document.documentElement.scrollHeight, max); y += step) {
      window.scrollTo(0, y)
      await new Promise(r => setTimeout(r, 120))
    }
    window.scrollTo(0, 0)
    await document.fonts?.ready
    const deadline = Date.now() + 6_000
    const pending = () => [...document.images].filter(i => {
      const r = i.getBoundingClientRect()
      return r.top + window.scrollY < max && r.width > 0 && r.height > 0 && !i.complete
    })
    while (pending().length && Date.now() < deadline) await new Promise(r => setTimeout(r, 150))
    await Promise.all([...document.images].filter(i => i.complete && i.naturalWidth).map(i => i.decode().catch(() => undefined)))
    // Galerijen (masonry, justified) schuiven nog als de laatste foto's binnen zijn: wachten tot alles stilstaat.
    const shape = () => `${document.documentElement.scrollHeight}|` + [...document.images].slice(0, 200).map(i => { const r = i.getBoundingClientRect(); return `${Math.round(r.top)},${Math.round(r.left)},${Math.round(r.width)}` }).join(';')
    let last = shape()
    for (let n = 0, still = 0; n < 12 && still < 2; n++) {
      await new Promise(r => setTimeout(r, 300))
      const now = shape()
      still = now === last ? still + 1 : 0
      last = now
    }
  }, MAX_SHOT_HEIGHT).catch(() => undefined)
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined)
  await page.waitForTimeout(500)
}

/** Laadt één pagina en legt status, fouten, structuur en (optioneel) een screenshot vast. */
export async function capturePage(ctx: BrowserContext, url: string, opts: CaptureOptions): Promise<PageCapture> {
  const page = await ctx.newPage()
  const origin = new URL(url).origin
  const jsErrors: string[] = []
  const failedResources = new Set<string>()
  page.on('pageerror', err => { if (jsErrors.length < 20) jsErrors.push(normalizeJsError(err.message)) })
  page.on('response', res => {
    const type = res.request().resourceType()
    if (res.status() >= 400 && ['script', 'stylesheet'].includes(type) && res.url().startsWith(origin)) {
      failedResources.add(new URL(res.url()).pathname)
    }
  })
  page.on('requestfailed', req => {
    if (['script', 'stylesheet'].includes(req.resourceType()) && req.url().startsWith(origin)) failedResources.add(new URL(req.url()).pathname)
  })
  const started = Date.now()
  const result: PageCapture = {
    url, status: null, loadMs: 0, error: null, phpError: null, jsErrors, failedResources: [], landmarks: [],
    textLength: 0, title: '', loginForm: null, screenshot: null,
  }
  try {
    const res = await page.goto(url, { waitUntil: 'load', timeout: opts.timeoutMs ?? 45_000 })
    result.status = res?.status() ?? null
    result.loadMs = Date.now() - started
    await settle(page)
    const html = await page.content()
    result.phpError = detectPhpError(html)
    result.title = (await page.title()).slice(0, 200)
    const facts = await page.evaluate(({ landmarks, moving, max }) => {
      // Alleen de buitenste bewegende blokken tellen (een slider in een slider niet dubbel).
      const els = [...document.querySelectorAll<HTMLElement>(moving.join(','))]
      const outer = els.filter(e => !els.some(o => o !== e && o.contains(e)))
      const height = outer.reduce((n, e) => {
        const r = e.getBoundingClientRect()
        const top = r.top + window.scrollY
        return top < max && r.width > 0 ? n + Math.max(0, Math.min(r.height, max - top)) : n
      }, 0)
      return {
        present: Object.entries(landmarks).filter(([, sel]) => document.querySelector(sel)).map(([k]) => k),
        text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().length,
        login: document.querySelector('#loginform') !== null,
        moving: Math.round(height),
        themes: [...new Set([...document.querySelectorAll('link[href],script[src]')]
          .map(e => (e.getAttribute('href') || e.getAttribute('src') || '').match(/\/wp-content\/themes\/([^/?#]+)\//)?.[1])
          .filter((x): x is string => Boolean(x)))].slice(0, 10),
      }
    }, { landmarks: LANDMARKS, moving: AUTO_MASKS, max: MAX_SHOT_HEIGHT })
    result.landmarks = facts.present as Landmark[]
    result.textLength = facts.text
    result.loginForm = facts.login
    result.moving = facts.moving
    result.themes = facts.themes
    if (opts.screenshot) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight)
      const width = page.viewportSize()?.width ?? 1280
      result.screenshot = await page.screenshot({
        fullPage: true,
        clip: { x: 0, y: 0, width, height: Math.max(1, Math.min(height, MAX_SHOT_HEIGHT)) },
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
        mask: [...AUTO_MASKS, ...opts.masks].map(sel => page.locator(sel)),
        maskColor: '#FF00FF',
        timeout: 30_000,
      })
    }
  } catch (err) {
    result.error = (err as Error).message.split('\n')[0]!.slice(0, 300)
    result.loadMs = Date.now() - started
  } finally {
    result.failedResources = [...failedResources].slice(0, 20)
    await page.close().catch(() => undefined)
  }
  return result
}
