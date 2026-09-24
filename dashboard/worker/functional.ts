import type { BrowserContext, Locator, Page } from 'playwright-core'
import { detectPhpError, normalizeJsError } from './checks'

/**
 * Functionele tests op de testkopie: werkt een formulier nog echt (invullen → versturen → bevestiging),
 * en kan een bezoeker in de webwinkel nog een product in de winkelwagen leggen en naar afrekenen?
 *
 * Veiligheid: dit draait alleen op de testkopie. Die verstuurt nooit e-mail, en met de cookie
 * `verploy_functional` blokkeert de connector (2.4+) al het uitgaande verkeer (CRM, Zapier, betaalprovider).
 * Er wordt nooit betaald of een bestelling geplaatst. Captcha's worden niet omzeild: zo'n formulier slaan we over.
 */

export type FormKind = 'cf7' | 'gravity' | 'wpforms'
export interface FunctionalTargets {
  forms: Array<{ key: string; kind: FormKind; label: string; url: string }>
  shop: { product: { key: string; label: string; url: string }; cart: string; checkout: string } | null
}
export type FnOutcome = 'ok' | 'failed' | 'inconclusive' | 'skipped'
export interface FnResult {
  key: string
  kind: 'form' | 'shop'
  formKind?: FormKind
  label: string
  url: string
  outcome: FnOutcome
  /** Waarom (sleutel onder runs.functional.reason). */
  reason: string
  jsErrors: string[]
}

const FORM_SELECTOR: Record<FormKind, string> = {
  cf7: 'form.wpcf7-form',
  gravity: 'form[id^="gform_"]',
  wpforms: 'form.wpforms-form',
}
const CAPTCHA = '.g-recaptcha, .cf-turnstile, .h-captcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .wpcf7-quiz, .gfield--type-captcha, .wpforms-recaptcha-container, input[name*="captcha" i]'
export const TEST_VALUES = {
  text: 'Verploy test',
  name: 'Verploy Test',
  email: 'verploy-test@example.com',
  tel: '0612345678',
  url: 'https://example.com',
  number: '1',
  message: 'Automatische test door Verploy op een testkopie van de site. Dit bericht kan worden genegeerd.',
}

/** Welke testwaarde past bij dit veld? (puur; voor tests) */
export function valueFor(field: { tag: string; type: string; name: string; min?: string | null }): string | null {
  const type = field.type.toLowerCase()
  const name = field.name.toLowerCase()
  if (field.tag === 'textarea') return TEST_VALUES.message
  if (type === 'email' || /e-?mail/.test(name)) return TEST_VALUES.email
  if (type === 'tel' || /phone|tel|telefoon/.test(name)) return TEST_VALUES.tel
  if (type === 'url' || /website|url/.test(name)) return TEST_VALUES.url
  if (type === 'number' || type === 'range') return field.min && field.min !== '' ? field.min : TEST_VALUES.number
  if (type === 'date') return '2030-01-15'
  if (['text', 'search', ''].includes(type)) return /name|naam/.test(name) ? TEST_VALUES.name : TEST_VALUES.text
  return null
}

async function withPage<T>(ctx: BrowserContext, fn: (page: Page, js: string[]) => Promise<T>): Promise<{ value: T; js: string[] }> {
  const page = await ctx.newPage()
  const js: string[] = []
  page.on('pageerror', err => { if (js.length < 20) js.push(normalizeJsError(err.message)) })
  try {
    return { value: await fn(page, js), js }
  } finally {
    await page.close().catch(() => undefined)
  }
}

async function visible(l: Locator) {
  return l.isVisible().catch(() => false)
}

/** Vult de velden in die een bezoeker zou invullen (zichtbaar en bewerkbaar), en kruist verplichte vinkjes aan. */
async function fill(form: Locator): Promise<'ok' | 'file_required'> {
  for (const field of await form.locator('input, textarea, select').all()) {
    if (!(await visible(field)) || !(await field.isEditable().catch(() => false))) continue
    const info = await field.evaluate((el: HTMLInputElement) => ({
      tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') ?? '').toLowerCase(), name: el.name ?? '', min: el.getAttribute('min'),
      required: el.required || el.getAttribute('aria-required') === 'true', checked: el.checked,
    }))
    if (['hidden', 'submit', 'button', 'image', 'reset', 'password'].includes(info.type)) continue
    if (info.type === 'file') { if (info.required) return 'file_required'; continue }
    if (info.tag === 'select') {
      const values = await field.evaluate((el: HTMLSelectElement) => [...el.options].filter(o => !o.disabled).map(o => o.value))
      const pick = values.find(v => v !== '') ?? values[0]
      if (pick !== undefined) await field.selectOption(pick).catch(() => undefined)
      continue
    }
    if (info.type === 'checkbox') { if (info.required || /accept|consent|privacy|gdpr|akkoord|voorwaarden/.test(info.name.toLowerCase())) await field.check().catch(() => undefined); continue }
    if (info.type === 'radio') { if (!info.checked) await field.check().catch(() => undefined); continue }
    const value = valueFor(info)
    if (value !== null) await field.fill(value).catch(() => undefined)
  }
  return 'ok'
}

type Verdict = { outcome: FnOutcome; reason: string }

/** Wacht op de uitkomst van het versturen, per formulierplugin. */
async function awaitResult(page: Page, kind: FormKind, form: Locator, startUrl: string): Promise<Verdict> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    await page.waitForTimeout(400)
    const html = await page.content().catch(() => '')
    if (detectPhpError(html)) return { outcome: 'failed', reason: 'php_error' }
    if (kind === 'cf7') {
      const status = await form.getAttribute('data-status').catch(() => null)
      if (status === 'sent') return { outcome: 'ok', reason: 'sent' }
      if (status === 'invalid' || status === 'spam') return { outcome: 'inconclusive', reason: 'validation' }
      if (status === 'failed' || status === 'aborted' || status === 'mail_failed') return { outcome: 'failed', reason: 'submit_failed' }
    }
    if (kind === 'gravity') {
      if (await page.locator('.gform_confirmation_message, [id^="gform_confirmation_wrapper"]').count()) return { outcome: 'ok', reason: 'sent' }
      if (await page.locator('.gform_validation_errors, .validation_error').count()) return { outcome: 'inconclusive', reason: 'validation' }
    }
    if (kind === 'wpforms') {
      if (await page.locator('.wpforms-confirmation-container, .wpforms-confirmation-container-full').count()) return { outcome: 'ok', reason: 'sent' }
      if (await page.locator('.wpforms-error-container, .wpforms-error-alert').count()) return { outcome: 'failed', reason: 'submit_failed' }
      if (await page.locator('label.wpforms-error, em.wpforms-error').count()) return { outcome: 'inconclusive', reason: 'validation' }
    }
    // Doorgestuurd naar een bedankpagina.
    if (page.url().split('#')[0] !== startUrl.split('#')[0] && !(await page.locator(FORM_SELECTOR[kind]).count())) return { outcome: 'ok', reason: 'redirected' }
  }
  return { outcome: 'failed', reason: 'no_response' }
}

export async function testForm(ctx: BrowserContext, target: FunctionalTargets['forms'][number]): Promise<FnResult> {
  const base = { key: `form:${target.key}:${target.kind}`, kind: 'form' as const, formKind: target.kind, label: target.label, url: target.url }
  try {
    const { value, js } = await withPage(ctx, async page => {
      const res = await page.goto(target.url, { waitUntil: 'load', timeout: 45_000 })
      if (!res || res.status() >= 400) return { outcome: 'failed', reason: 'page' } as Verdict
      const form = page.locator(FORM_SELECTOR[target.kind]).first()
      if (!(await form.count()) || !(await visible(form))) return { outcome: 'failed', reason: 'not_rendered' } as Verdict
      if (await form.locator(CAPTCHA).count() || await page.locator(CAPTCHA).count()) return { outcome: 'skipped', reason: 'captcha' } as Verdict
      if (await fill(form) === 'file_required') return { outcome: 'skipped', reason: 'file_required' } as Verdict
      const submit = form.locator('button[type="submit"], input[type="submit"], .wpforms-submit, .gform_button').first()
      if (!(await submit.count())) return { outcome: 'failed', reason: 'no_submit' } as Verdict
      const startUrl = page.url()
      await submit.click({ timeout: 10_000 })
      return awaitResult(page, target.kind, form, startUrl)
    })
    return { ...base, ...value, jsErrors: js }
  } catch (err) {
    return { ...base, outcome: 'failed', reason: 'no_response', jsErrors: [String((err as Error).message ?? err).slice(0, 200)] }
  }
}

/** Webwinkel: product → in winkelwagen → winkelwagen → afrekenen (zonder te bestellen). */
export async function testShop(ctx: BrowserContext, shop: NonNullable<FunctionalTargets['shop']>): Promise<FnResult> {
  const base = { key: 'shop', kind: 'shop' as const, label: shop.product.label, url: shop.product.url }
  try {
    const { value, js } = await withPage(ctx, async page => {
      const product = await page.goto(shop.product.url, { waitUntil: 'load', timeout: 45_000 })
      if (!product || product.status() >= 400 || detectPhpError(await page.content())) return { outcome: 'failed', reason: 'product_page' } as Verdict
      const add = page.locator('form.cart button[type="submit"], button.single_add_to_cart_button, .wc-block-components-product-button button').first()
      if (!(await add.count()) || !(await visible(add))) return { outcome: 'failed', reason: 'add_to_cart' } as Verdict
      await add.click({ timeout: 10_000 })
      await page.waitForLoadState('load').catch(() => undefined)
      await page.waitForTimeout(1500)
      const cart = await page.goto(shop.cart, { waitUntil: 'load', timeout: 45_000 })
      if (!cart || cart.status() >= 400 || detectPhpError(await page.content())) return { outcome: 'failed', reason: 'cart' } as Verdict
      const inCart = page.locator('.woocommerce-cart-form .cart_item, .wc-block-cart-items__row, .wc-block-cart-item')
      await inCart.first().waitFor({ timeout: 10_000 }).catch(() => undefined)
      if (!(await inCart.count())) return { outcome: 'failed', reason: 'add_to_cart' } as Verdict
      const checkout = await page.goto(shop.checkout, { waitUntil: 'load', timeout: 45_000 })
      if (!checkout || checkout.status() >= 400 || detectPhpError(await page.content())) return { outcome: 'failed', reason: 'checkout' } as Verdict
      const form = page.locator('form.checkout, form.woocommerce-checkout, .wc-block-checkout')
      await form.first().waitFor({ timeout: 10_000 }).catch(() => undefined)
      if (!(await form.count())) return { outcome: 'failed', reason: 'checkout' } as Verdict
      return { outcome: 'ok', reason: 'checkout_reached' } as Verdict
    })
    return { ...base, ...value, jsErrors: js }
  } catch (err) {
    return { ...base, outcome: 'failed', reason: 'no_response', jsErrors: [String((err as Error).message ?? err).slice(0, 200)] }
  }
}

export async function runFunctional(ctx: BrowserContext, targets: FunctionalTargets): Promise<FnResult[]> {
  const out: FnResult[] = []
  for (const f of targets.forms) out.push(await testForm(ctx, f))
  if (targets.shop) out.push(await testShop(ctx, targets.shop))
  return out
}

export interface FnFailure { key: string; kind: 'form' | 'shop'; formKind?: FormKind; label: string; url: string; reason: string; errors?: string[] }

/**
 * Wat werkte vóór de update en ná de update niet meer? Alleen dat blokkeert: een formulier met een
 * captcha, een bestaande fout of een onduidelijke uitkomst vóóraf houdt een update niet tegen.
 */
export function compareFunctional(before: FnResult[], after: FnResult[]): FnFailure[] {
  const out: FnFailure[] = []
  for (const b of before) {
    if (b.outcome !== 'ok') continue
    const a = after.find(x => x.key === b.key)
    const f = { key: b.key, kind: b.kind, ...(b.formKind ? { formKind: b.formKind } : {}), label: b.label, url: b.url }
    if (!a) { out.push({ ...f, reason: 'not_rendered' }); continue }
    if (a.outcome === 'failed') { out.push({ ...f, reason: a.reason }); continue }
    if (a.outcome === 'inconclusive') { out.push({ ...f, reason: 'validation' }); continue }
    const newJs = a.jsErrors.filter(e => !b.jsErrors.includes(e))
    if (newJs.length) out.push({ ...f, reason: 'js', errors: newJs.slice(0, 3) })
  }
  return out
}
