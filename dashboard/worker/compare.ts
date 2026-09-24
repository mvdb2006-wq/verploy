import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import type { Landmark, PageCapture } from './checks'

export type CheckName = 'reachable' | 'http' | 'php_error' | 'js_errors' | 'resources' | 'landmarks' | 'content' | 'visual' | 'login' | 'form' | 'shop'
export interface CheckOutcome { check: CheckName; ok: boolean; detail?: Record<string, string | number | string[]> }

export interface VisualDiff { ratio: number; diffPng: Buffer }

/**
 * Pixelvergelijking van twee screenshots. Verschillende hoogtes: de gemeenschappelijke
 * hoogte wordt vergeleken en elke extra rij telt volledig als verschil.
 */
export function visualDiff(beforePng: Buffer, afterPng: Buffer): VisualDiff {
  const a = PNG.sync.read(beforePng)
  const b = PNG.sync.read(afterPng)
  const width = Math.min(a.width, b.width)
  const height = Math.min(a.height, b.height)
  const crop = (img: PNG): Buffer => {
    if (img.width === width && img.height === height) return img.data
    const out = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) img.data.copy(out, y * width * 4, y * img.width * 4, y * img.width * 4 + width * 4)
    return out
  }
  const diff = new PNG({ width, height })
  const changed = pixelmatch(crop(a), crop(b), diff.data, width, height, { threshold: 0.1, includeAA: false, alpha: 0.3 })
  const maxW = Math.max(a.width, b.width)
  const maxH = Math.max(a.height, b.height)
  const extra = maxW * maxH - width * height
  return { ratio: (changed + extra) / (maxW * maxH), diffPng: PNG.sync.write(diff) }
}

/** Is de pagina op zichzelf bruikbaar? (voor de "voor"-metingen: bepaalt wat we later mogen verwachten) */
export function healthy(c: PageCapture): boolean {
  return c.error === null && c.status !== null && c.status < 400 && c.phpError === null
}

/**
 * Vergelijkt een meting ná de update met dezelfde pagina ervóór. Alleen wat vóór de update
 * werkte, moet erna nog werken: bestaande problemen van een site blokkeren geen update.
 */
export function comparePage(before: PageCapture, after: PageCapture, visual: { ratio: number; threshold: number } | null): CheckOutcome[] {
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

  if (visual) out.push({ check: 'visual', ok: visual.ratio <= visual.threshold, detail: { ratio: Number(visual.ratio.toFixed(4)), threshold: visual.threshold } })
  return out
}

/** Eerste gezakte check, voor de samenvatting ("waarom tegengehouden"). */
export function firstFailure(outcomes: CheckOutcome[]): CheckOutcome | null {
  const order: CheckName[] = ['reachable', 'php_error', 'http', 'login', 'shop', 'form', 'landmarks', 'content', 'resources', 'js_errors', 'visual']
  const failed = outcomes.filter(o => !o.ok)
  failed.sort((a, b) => order.indexOf(a.check) - order.indexOf(b.check))
  return failed[0] ?? null
}
