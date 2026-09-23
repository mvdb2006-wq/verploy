import { describe, expect, it } from 'vitest'
import { createTranslator } from '@/lib/i18n/core'
import { classifyFatal, componentFromPath, ruleDiagnosis, type Evidence } from './rules'
import { DiagnosisApiError, OUTPUT_SCHEMA, buildPrompt, refineWithClaude } from './claude'

const nl = createTranslator('nl')
const en = createTranslator('en')

const base = (over: Partial<Evidence> = {}): Evidence => ({
  where: 'staging',
  items: [{ type: 'plugin', slug: 'vp-lab-fatal/vp-lab-fatal.php', name: 'Verploy Lab — vp-lab-fatal', from_version: '1.0.0', to_version: '1.1.0', status: 'updated' }],
  failures: [{ page: 'Home', viewport: 'desktop', check: 'php_error', detail: { error: 'wp_critical_error' } }],
  fatals: [],
  log_tail: [],
  environment: { wp_version: '7.1.2', php_version: '8.3.1', theme: 'Twenty Twenty-Five 1.3', plugins: [
    { slug: 'vp-lab-fatal/vp-lab-fatal.php', name: 'Verploy Lab — vp-lab-fatal', version: '1.1.0' },
    { slug: 'woocommerce/woocommerce.php', name: 'WooCommerce', version: '10.1.0' },
  ] },
  ...over,
})

describe('herkenning', () => {
  it('plugin of thema uit een pad of melding', () => {
    expect(componentFromPath('…/wp-content/plugins/vp-lab-fatal/vp-lab-fatal.php')).toEqual({ kind: 'plugin', dir: 'vp-lab-fatal' })
    expect(componentFromPath('Uncaught Error in …/wp-content/themes/astra/functions.php:12')).toEqual({ kind: 'theme', dir: 'astra' })
    expect(componentFromPath('…/wp-includes/load.php')).toBeNull()
  })
  it('soort fatale fout', () => {
    expect(classifyFatal('Uncaught Error: Call to undefined function wc_get_product() in …')).toEqual({ category: 'undefined_function', vars: { fn: 'wc_get_product' } })
    expect(classifyFatal('Uncaught Error: Class "Foo\\Bar" not found')).toEqual({ category: 'missing_class', vars: { cls: 'Foo\\Bar' } })
    expect(classifyFatal('Uncaught Error: Call to undefined method WC_Cart::get_foo()').category).toBe('undefined_method')
    expect(classifyFatal('Allowed memory size of 134217728 bytes exhausted (tried to allocate 20480 bytes)').category).toBe('memory')
    expect(classifyFatal('Cannot redeclare my_helper() (previously declared in …)').category).toBe('redeclare')
    expect(classifyFatal('syntax error, unexpected token "}"').category).toBe('syntax')
    expect(classifyFatal('Composer detected issues in your platform: Your Composer dependencies require a PHP version ">= 8.2.0"').category).toBe('php_version')
    expect(classifyFatal('Something else broke').category).toBe('fatal_other')
  })
})

describe('regelgebaseerde diagnose', () => {
  it('fatale fout in de bijgewerkte plugin: die plugin, hoge zekerheid, functie genoemd', () => {
    const d = ruleDiagnosis(base({ fatals: [{ message: 'Uncaught Error: Call to undefined function verploy_lab_function_that_does_not_exist()', file: '…/wp-content/plugins/vp-lab-fatal/vp-lab-fatal.php', line: 11 }] }), nl)
    expect(d).toMatchObject({ category: 'undefined_function', culprit_slug: 'vp-lab-fatal/vp-lab-fatal.php', confidence: 'high' })
    expect(d.summary).toBe('Verploy Lab — vp-lab-fatal 1.1.0 roept een functie aan die niet bestaat (verploy_lab_function_that_does_not_exist).')
    expect(d.cause).toContain('wp-content/plugins/vp-lab-fatal/vp-lab-fatal.php (regel 11)')
    expect(d.fix).toContain('op versie 1.0.0')
  })
  it('fatale fout in een níet bijgewerkte plugin: conflict, die plugin als oorzaak', () => {
    const d = ruleDiagnosis(base({ fatals: [{ message: 'Uncaught Error: Call to undefined method Vp_Lab::old_api()', file: '…/wp-content/plugins/woocommerce/includes/class-wc.php', line: 90 }] }), en)
    expect(d).toMatchObject({ category: 'conflict', culprit_slug: 'woocommerce/woocommerce.php', culprit_name: 'WooCommerce', confidence: 'medium' })
    expect(d.summary).toBe('WooCommerce does not work with Verploy Lab — vp-lab-fatal 1.1.0.')
    expect(d.cause).toContain('it calls a method that does not exist (Vp_Lab::old_api)')
  })
  it('zonder foutmelding: op basis van de eerste gezakte test', () => {
    const d = ruleDiagnosis(base({ failures: [{ page: 'Contact', viewport: 'mobile', check: 'visual', detail: { ratio: 0.0634, threshold: 0.02 } }] }), nl, 'nl')
    expect(d).toMatchObject({ category: 'visual', confidence: 'low' })
    expect(d.summary).toBe('Contact ziet er na de update anders uit (6,3% verschil, Mobiel).')
  })
  it('update niet te installeren door rechten', () => {
    const d = ruleDiagnosis(base({ items: [{ ...base().items[0]!, status: 'filesystem_not_writable' }], failures: [] }), nl)
    expect(d.category).toBe('no_write_access')
    expect(d.cause).toContain('Geen schrijfrechten op de server')
  })
  it('elke categorie heeft teksten in alle talen (geen ontbrekende sleutels)', () => {
    for (const locale of ['nl', 'en', 'de', 'fr', 'es'] as const) {
      const t = createTranslator(locale)
      for (const check of ['reachable', 'http', 'php_error', 'js_errors', 'resources', 'landmarks', 'content', 'visual', 'login', 'nieuw']) {
        const d = ruleDiagnosis(base({ failures: [{ page: 'Home', viewport: 'desktop', check }] }), t)
        for (const text of [d.summary, d.cause, d.fix]) expect(text, `${locale}/${check}`).not.toMatch(/^diagnosis\.|\{\w+\}/)
      }
    }
  })
})

function claudeResponse(json: unknown, stop = 'end_turn', status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify({
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5', stop_reason: stop,
    content: [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }],
    usage: { input_tokens: 900, output_tokens: 200 },
  }), { status })) as unknown as typeof fetch
}

describe('verfijning met Claude', () => {
  const evidence = base({ fatals: [{ message: 'Uncaught Error: Call to undefined function x()', file: '…/wp-content/plugins/vp-lab-fatal/vp-lab-fatal.php', line: 11 }] })
  const draft = ruleDiagnosis(evidence, nl)

  it('stuurt model, structured-output-schema en taal mee', async () => {
    let sent: { url: string; init: RequestInit } | null = null
    const f = (async (url: string, init: RequestInit) => {
      sent = { url, init }
      return claudeResponse({ summary: 's', cause: 'c', fix: 'f', culprit_slug: 'vp-lab-fatal', confidence: 'High' })(url, init)
    }) as unknown as typeof fetch
    const r = await refineWithClaude(evidence, draft, 'nl', { apiKey: 'sk-test', fetch: f })
    const body = JSON.parse(String(sent!.init.body))
    expect(sent!.url).toBe('https://api.anthropic.com/v1/messages')
    expect((sent!.init.headers as Record<string, string>)['x-api-key']).toBe('sk-test')
    expect(body.model).toBe('claude-sonnet-5')
    expect(body.output_config.format).toEqual({ type: 'json_schema', schema: OUTPUT_SCHEMA })
    expect(body.system).toContain('in Dutch')
    // slug wordt terugvertaald naar een bekende plugin, confidence hoofdletterongevoelig
    expect(r).toMatchObject({ summary: 's', culprit_slug: 'vp-lab-fatal/vp-lab-fatal.php', culprit_name: 'Verploy Lab — vp-lab-fatal', confidence: 'high', model: 'claude-sonnet-5' })
  })

  it('verzonnen plugin wordt genegeerd: dan blijft de schuldige uit de regels staan', async () => {
    const r = await refineWithClaude(evidence, draft, 'nl', { apiKey: 'k', fetch: claudeResponse({ summary: 's', cause: 'c', fix: 'f', culprit_slug: 'bestaat-niet', confidence: 'low' }) })
    expect(r.culprit_slug).toBe(draft.culprit_slug)
  })

  it('weigering, afgebroken antwoord, HTTP-fout of ongeldige JSON → fout (terugval op regels)', async () => {
    await expect(refineWithClaude(evidence, draft, 'nl', { apiKey: 'k', fetch: claudeResponse({}, 'refusal') })).rejects.toBeInstanceOf(DiagnosisApiError)
    await expect(refineWithClaude(evidence, draft, 'nl', { apiKey: 'k', fetch: claudeResponse({}, 'max_tokens') })).rejects.toBeInstanceOf(DiagnosisApiError)
    await expect(refineWithClaude(evidence, draft, 'nl', { apiKey: 'k', fetch: claudeResponse({ error: { message: 'overloaded' } }, 'end_turn', 529) })).rejects.toBeInstanceOf(DiagnosisApiError)
    await expect(refineWithClaude(evidence, draft, 'nl', { apiKey: 'k', fetch: claudeResponse('{niet: json') })).rejects.toBeInstanceOf(DiagnosisApiError)
    await expect(refineWithClaude(evidence, draft, 'nl', { apiKey: 'k', fetch: claudeResponse({ summary: '', cause: 'c', fix: 'f', culprit_slug: '', confidence: 'high' }) })).rejects.toBeInstanceOf(DiagnosisApiError)
  })

  it('prompt bevat het bewijs en het regelconcept, zonder serverpaden', () => {
    const { user } = buildPrompt(evidence, draft, 'de')
    expect(user).toContain('vp-lab-fatal.php')
    expect(user).toContain('rule_based_draft')
    expect(user).not.toMatch(/\/home\/|\/var\/www/)
  })
})
