import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import { comparePage, dynamicMask, firstFailure, healthy, maskCoverage, visualDiff } from './compare'
import { detectPhpError, normalizeJsError, type PageCapture } from './checks'

function png(width: number, height: number, paint: (x: number, y: number) => [number, number, number] = () => [255, 255, 255]): Buffer {
  const img = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    const [r, g, b] = paint(x, y)
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
  }
  return PNG.sync.write(img)
}

const page = (over: Partial<PageCapture> = {}): PageCapture => ({
  url: 'https://x.example/', status: 200, loadMs: 300, error: null, phpError: null, jsErrors: [], failedResources: [],
  landmarks: ['header', 'nav', 'main', 'footer'], textLength: 2000, title: 'Home', loginForm: false, screenshot: null, ...over,
})

describe('visualDiff', () => {
  it('identieke beelden: 0 %', () => {
    const a = png(100, 80)
    expect(visualDiff(a, a).ratio).toBe(0)
  })
  it('een blok van 10 × 8 van 100 × 80 anders: 1 %', () => {
    const a = png(100, 80)
    const b = png(100, 80, (x, y) => (x < 10 && y < 8 ? [0, 0, 0] : [255, 255, 255]))
    expect(visualDiff(a, b).ratio).toBeCloseTo(0.01, 4)
  })
  it('langere pagina: de extra rijen tellen volledig als verschil', () => {
    const a = png(100, 80)
    const b = png(100, 100)
    expect(visualDiff(a, b).ratio).toBeCloseTo(20 / 100, 4)
  })
  it('levert een diff-afbeelding van de gemeenschappelijke maat', () => {
    const d = PNG.sync.read(visualDiff(png(50, 40), png(60, 30)).diffPng)
    expect([d.width, d.height]).toEqual([50, 30])
  })
})

describe('comparePage', () => {
  it('niets veranderd: alles groen', () => {
    const out = comparePage(page(), page(), { ratio: 0.001, threshold: 0.02 })
    expect(out.every(o => o.ok)).toBe(true)
    expect(out.map(o => o.check)).toEqual(['reachable', 'http', 'php_error', 'js_errors', 'resources', 'landmarks', 'content', 'visual'])
  })
  it('kritieke fout na de update: php_error + http rood', () => {
    const out = comparePage(page(), page({ status: 500, phpError: 'wp_critical_error', landmarks: [], textLength: 60 }), null)
    expect(firstFailure(out)?.check).toBe('php_error')
    expect(out.filter(o => !o.ok).map(o => o.check).sort()).toEqual(['content', 'http', 'landmarks', 'php_error'])
  })
  it('bestaande problemen blokkeren niet: 404 blijft 404, oude JS-fout blijft', () => {
    const before = page({ status: 404, jsErrors: ['TypeError: x is undefined'] })
    const out = comparePage(before, page({ status: 404, jsErrors: ['TypeError: x is undefined'] }), null)
    expect(out.every(o => o.ok)).toBe(true)
  })
  it('nieuwe JS-fout, nieuw kapot script en verdwenen footer worden gemeld', () => {
    const out = comparePage(page(), page({ jsErrors: ['ReferenceError: jQuery is not defined'], failedResources: ['/wp-content/plugins/x/app.js'], landmarks: ['header', 'nav', 'main'] }), null)
    const failed = Object.fromEntries(out.filter(o => !o.ok).map(o => [o.check, o.detail]))
    expect(failed.js_errors).toEqual({ errors: ['ReferenceError: jQuery is not defined'] })
    expect(failed.resources).toEqual({ resources: ['/wp-content/plugins/x/app.js'] })
    expect(failed.landmarks).toEqual({ missing: ['footer'] })
  })
  it('visueel verschil boven de drempel is rood, eronder groen', () => {
    expect(comparePage(page(), page(), { ratio: 0.05, threshold: 0.02 }).find(o => o.check === 'visual')?.ok).toBe(false)
    expect(comparePage(page(), page(), { ratio: 0.019, threshold: 0.02 }).find(o => o.check === 'visual')?.ok).toBe(true)
  })
  it('onbereikbaar na de update: alleen reachable (rood)', () => {
    const out = comparePage(page(), page({ error: 'net::ERR_CONNECTION_REFUSED', status: null }), null)
    expect(out).toEqual([{ check: 'reachable', ok: false, detail: { error: 'net::ERR_CONNECTION_REFUSED' } }])
  })
  it('inlogformulier dat verdwijnt is rood', () => {
    const out = comparePage(page({ loginForm: true }), page({ loginForm: false }), null)
    expect(out.find(o => o.check === 'login')?.ok).toBe(false)
  })
  it('healthy: status < 400 zonder fouten', () => {
    expect(healthy(page())).toBe(true)
    expect(healthy(page({ status: 503 }))).toBe(false)
    expect(healthy(page({ phpError: 'php_fatal' }))).toBe(false)
  })
})

describe('herkenning', () => {
  it('PHP- en WordPress-foutpagina’s', () => {
    expect(detectPhpError('<p>There has been a critical error on this website.</p>')).toBe('wp_critical_error')
    expect(detectPhpError('<br />\n<b>Fatal error</b>:  Uncaught Error')).toBe('php_fatal')
    expect(detectPhpError('<h1>Error establishing a database connection</h1>')).toBe('db_connection')
    expect(detectPhpError('<p>Welkom</p>')).toBeNull()
  })
  it('JS-fouten zonder URL’s en regelnummers', () => {
    expect(normalizeJsError('x is not a function at https://a.example/app.js?ver=1712345678:12:44'))
      .toBe('x is not a function at <url>')
  })
})

describe('bewegende delen (slider, video) negeren', () => {
  // 100×100 pagina; bovenin (y < 20) een "slider" die per lading een andere kleur heeft.
  const page = (slide: [number, number, number], extra?: (x: number, y: number) => [number, number, number] | null) =>
    png(100, 100, (x, y) => extra?.(x, y) ?? (y < 20 ? slide : [255, 255, 255]))
  const red: [number, number, number] = [200, 30, 30]
  const green: [number, number, number] = [30, 200, 30]
  const blue: [number, number, number] = [30, 30, 200]

  it('dynamicMask: markeert wat tussen twee ladingen van dezelfde pagina verschilt, met marge', () => {
    const m = dynamicMask([page(green), page(blue)], 2)!
    expect(m.mask[10 * 100 + 50]).toBe(1)          // in de slider
    expect(m.mask[21 * 100 + 50]).toBe(1)          // marge eronder
    expect(m.mask[60 * 100 + 50]).toBe(0)          // rest van de pagina
    expect(maskCoverage(m)).toBeCloseTo(0.22, 2)
    expect(dynamicMask([page(green)])).toBeNull()
    expect(maskCoverage(dynamicMask([page(green), page(green)])!)).toBe(0)
  })

  it('alleen de slider wisselde: zonder masker 20% verschil, met masker 0% (blauw in het verschilbeeld)', () => {
    const before = page(red)
    const after = page(green)
    expect(visualDiff(before, after).ratio).toBeCloseTo(0.2, 3)
    const d = visualDiff(before, after, dynamicMask([after, page(blue)], 2))
    expect(d.ratio).toBe(0)
    expect(d.ignored).toBeCloseTo(0.22, 2)
    const img = PNG.sync.read(d.diffPng)
    expect([...img.data.subarray((10 * 100 + 50) * 4, (10 * 100 + 50) * 4 + 3)]).toEqual([120, 170, 255])
  })

  it('een echte wijziging buiten de slider blijft zichtbaar (en telt strenger mee)', () => {
    const before = page(red)
    const broken = (s: [number, number, number]) => page(s, (_x, y) => (y >= 50 && y < 60 ? [0, 0, 0] : null))
    const after = broken(green)
    const d = visualDiff(before, after, dynamicMask([after, broken(blue)], 2))
    expect(d.ratio).toBeCloseTo(10 / 78, 2)            // 10 rijen van de 78 niet-bewegende rijen
  })
})
