import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import type { Landmark, PageCapture } from './checks'

export type CheckName = 'reachable' | 'http' | 'php_error' | 'js_errors' | 'resources' | 'landmarks' | 'content' | 'visual' | 'login' | 'form' | 'shop'
export interface CheckOutcome { check: CheckName; ok: boolean; detail?: Record<string, string | number | string[]> }

export interface VisualDiff { ratio: number; diffPng: Buffer; /** Deel van de pagina dat als "beweegt vanzelf" is genegeerd. */ ignored: number }

/** Pixels die vanzelf veranderen (slider, video, wisselende foto's), gemeten op één pagina die meermaals is geladen. */
export interface DynamicMask { width: number; height: number; mask: Uint8Array }

/** Kleur in het verschilbeeld voor genegeerde (bewegende) delen. */
const IGNORED_RGB = [120, 170, 255] as const

function cropTo(img: PNG, width: number, height: number): Buffer {
  if (img.width === width && img.height === height) return img.data
  const out = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) img.data.copy(out, y * width * 4, y * img.width * 4, y * img.width * 4 + width * 4)
  return out
}

/**
 * Pixelvergelijking van twee screenshots. Verschillende hoogtes: de gemeenschappelijke
 * hoogte wordt vergeleken en elke extra rij telt volledig als verschil.
 * Met `ignore` tellen pixels die vanzelf bewegen niet mee (en ook niet in de noemer: de
 * rest van de pagina moet dus net zo streng gelijk blijven).
 */
export function visualDiff(beforePng: Buffer, afterPng: Buffer, ignore?: DynamicMask | null): VisualDiff {
  const a = PNG.sync.read(beforePng)
  const b = PNG.sync.read(afterPng)
  const width = Math.min(a.width, b.width)
  const height = Math.min(a.height, b.height)
  const diff = new PNG({ width, height })
  let changed = pixelmatch(cropTo(a, width, height), cropTo(b, width, height), diff.data, width, height, { threshold: 0.1, includeAA: false, alpha: 0.3 })
  let ignoredCount = 0
  if (ignore) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x >= ignore.width || y >= ignore.height || !ignore.mask[y * ignore.width + x]) continue
        ignoredCount++
        const i = (y * width + x) * 4
        // pixelmatch kleurt verschillen puur rood (255,0,0); die tellen hier niet mee.
        if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0) changed--
        diff.data[i] = IGNORED_RGB[0]; diff.data[i + 1] = IGNORED_RGB[1]; diff.data[i + 2] = IGNORED_RGB[2]; diff.data[i + 3] = 255
      }
    }
  }
  const maxW = Math.max(a.width, b.width)
  const maxH = Math.max(a.height, b.height)
  const extra = maxW * maxH - width * height
  const total = maxW * maxH
  return { ratio: (changed + extra) / Math.max(1, total - ignoredCount), diffPng: PNG.sync.write(diff), ignored: ignoredCount / total }
}

/**
 * Welke delen van een pagina bewegen vanzelf? Vergelijkt screenshots van dezelfde pagina (zelfde
 * toestand, opnieuw geladen) en markeert elk pixel dat daartussen verschilt, met een marge eromheen.
 * Wat na een update anders is maar óók zonder update steeds verandert, zegt niets over de update.
 */
export function dynamicMask(pngs: Buffer[], margin = 12): DynamicMask | null {
  if (pngs.length < 2) return null
  const imgs = pngs.map(p => PNG.sync.read(p))
  const width = Math.min(...imgs.map(i => i.width))
  const height = Math.min(...imgs.map(i => i.height))
  const raw = new Uint8Array(width * height)
  const out = new PNG({ width, height })
  for (let k = 1; k < imgs.length; k++) {
    pixelmatch(cropTo(imgs[0]!, width, height), cropTo(imgs[k]!, width, height), out.data, width, height, { threshold: 0.1, includeAA: false, diffMask: true })
    for (let p = 0; p < width * height; p++) if (out.data[p * 4 + 3]! > 0) raw[p] = 1
    out.data.fill(0)
  }
  // Marge: eerst horizontaal, dan verticaal (vierkant rond elk bewegend pixel).
  const h = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    let last = -Infinity
    for (let x = 0; x < width; x++) if (raw[y * width + x]) last = x; else if (x - last <= margin) h[y * width + x] = 1
    last = Infinity
    for (let x = width - 1; x >= 0; x--) if (raw[y * width + x]) { last = x; h[y * width + x] = 1 } else if (last - x <= margin) h[y * width + x] = 1
  }
  const mask = new Uint8Array(width * height)
  for (let x = 0; x < width; x++) {
    let last = -Infinity
    for (let y = 0; y < height; y++) if (h[y * width + x]) last = y; else if (y - last <= margin) mask[y * width + x] = 1
    last = Infinity
    for (let y = height - 1; y >= 0; y--) if (h[y * width + x]) { last = y; mask[y * width + x] = 1 } else if (last - y <= margin) mask[y * width + x] = 1
  }
  return { width, height, mask }
}

/** Deel van de pagina dat de maskering beslaat. */
export function maskCoverage(m: DynamicMask): number {
  let n = 0
  for (let i = 0; i < m.mask.length; i++) n += m.mask[i]!
  return n / Math.max(1, m.mask.length)
}

/** Is de pagina op zichzelf bruikbaar? (voor de "voor"-metingen: bepaalt wat we later mogen verwachten) */
export function healthy(c: PageCapture): boolean {
  return c.error === null && c.status !== null && c.status < 400 && c.phpError === null
}

/**
 * Vergelijkt een meting ná de update met dezelfde pagina ervóór. Alleen wat vóór de update
 * werkte, moet erna nog werken: bestaande problemen van een site blokkeren geen update.
 */
export function comparePage(before: PageCapture, after: PageCapture, visual: { ratio: number; threshold: number; ignored?: number } | null): CheckOutcome[] {
  const out: CheckOutcome[] = []
  const wasOk = healthy(before)
  out.push({ check: 'reachable', ok: after.error === null || before.error !== null, ...(after.error ? { detail: { error: after.error } } : {}) })
  if (after.error !== null) return out

  const status = after.status ?? 0
  const statusOk = status < 500 && (status < 400 || (before.status ?? 0) >= 400)
  out.push({ check: 'http', ok: statusOk, detail: { before: before.status ?? 0, after: status } })

  out.push({ check: 'php_error', ok: after.phpError === null || before.phpError === after.phpError, ...(after.phpError ? { detail: { error: after.phpError } } : {}) })

  const newJs = after.jsErrors.filter(e => !before.jsErrors.includes(e))
  out.push({ check: 'js_errors', ok: newJs.length === 0, ...(newJs.length ? { detail: { errors: newJs.slice(0, 5) } } : {}) })

  const newRes = after.failedResources.filter(r => !before.failedResources.includes(r))
  out.push({ check: 'resources', ok: newRes.length === 0, ...(newRes.length ? { detail: { resources: newRes.slice(0, 5) } } : {}) })

  if (wasOk) {
    const missing = before.landmarks.filter((l: Landmark) => !after.landmarks.includes(l))
    out.push({ check: 'landmarks', ok: missing.length === 0, ...(missing.length ? { detail: { missing } } : {}) })
    const contentOk = before.textLength < 200 || after.textLength >= before.textLength * 0.5
    out.push({ check: 'content', ok: contentOk, detail: { before: before.textLength, after: after.textLength } })
    if (before.loginForm) out.push({ check: 'login', ok: after.loginForm === true })
  }

  if (visual) {
    out.push({ check: 'visual', ok: visual.ratio <= visual.threshold, detail: {
      ratio: Number(visual.ratio.toFixed(4)), threshold: visual.threshold,
      ...(visual.ignored ? { ignored: Number(visual.ignored.toFixed(4)) } : {}),
    } })
  }
  return out
}

/** Eerste gezakte check, voor de samenvatting ("waarom tegengehouden"). */
export function firstFailure(outcomes: CheckOutcome[]): CheckOutcome | null {
  const order: CheckName[] = ['reachable', 'php_error', 'http', 'login', 'shop', 'form', 'landmarks', 'content', 'resources', 'js_errors', 'visual']
  const failed = outcomes.filter(o => !o.ok)
  failed.sort((a, b) => order.indexOf(a.check) - order.indexOf(b.check))
  return failed[0] ?? null
}
