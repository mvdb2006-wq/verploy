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
  // Lazy-loaded afbeeldingen laden door één keer naar beneden en terug te scrollen.
  await page.evaluate(async (max) => {
    const step = window.innerHeight
    for (let y = 0; y < Math.min(document.documentElement.scrollHeight, max); y += step) {
      window.scrollTo(0, y)
      await new Promise(r => setTimeout(r, 60))
    }
    window.scrollTo(0, 0)
    await document.fonts?.ready
  }, MAX_SHOT_HEIGHT).catch(() => undefined)
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined)
  await page.waitForTimeout(400)
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
    const facts = await page.evaluate((landmarks) => ({
      present: Object.entries(landmarks).filter(([, sel]) => document.querySelector(sel)).map(([k]) => k),
      text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().length,
      login: document.querySelector('#loginform') !== null,
    }), LANDMARKS)
    result.landmarks = facts.present as Landmark[]
    result.textLength = facts.text
    result.loginForm = facts.login
    if (opts.screenshot) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight)
      const width = page.viewportSize()?.width ?? 1280
      result.screenshot = await page.screenshot({
        fullPage: true,
        clip: { x: 0, y: 0, width, height: Math.max(1, Math.min(height, MAX_SHOT_HEIGHT)) },
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
        mask: opts.masks.map(sel => page.locator(sel)),
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
