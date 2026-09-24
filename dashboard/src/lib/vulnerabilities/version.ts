/**
 * Versievergelijking volgens PHP's version_compare(), zodat Verploy dezelfde uitkomst geeft als
 * WordPress en de Wordfence-feed (die versies op die manier bedoelt).
 *  - "1.0.0" = "1.0"? Nee: PHP ziet "1.0" < "1.0.0" niet als gelijk maar vergelijkt deel voor deel;
 *    een ontbrekend numeriek deel maakt de kortere versie kleiner.
 *  - Speciale woorden: dev < alpha = a < beta = b < RC = rc < (getal) < pl = p.
 */
const SPECIAL: Record<string, number> = { dev: 0, alpha: 1, a: 1, beta: 2, b: 2, rc: 3, '#': 4, pl: 5, p: 5 }

function canonical(v: string): string[] {
  return v
    .trim()
    .replace(/[-_+]/g, '.')
    .replace(/([^.\d]+)(\d)/g, '$1.$2')
    .replace(/(\d)([^.\d]+)/g, '$1.$2')
    .split('.')
    .filter(part => part !== '')
}

const isNum = (s: string) => /^\d+$/.test(s)
const order = (s: string) => SPECIAL[s.toLowerCase()] ?? -6

function comparePart(a: string, b: string): number {
  if (isNum(a) && isNum(b)) return Math.sign(Number(a) - Number(b))
  if (isNum(a)) return Math.sign(order('#') - order(b))
  if (isNum(b)) return Math.sign(order(a) - order('#'))
  return Math.sign(order(a) - order(b))
}

/** -1, 0 of 1 — zoals version_compare($a, $b). */
export function compareVersions(a: string, b: string): number {
  const pa = canonical(a)
  const pb = canonical(b)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return isNum(y!) ? -1 : comparePart('#', y!)
    if (y === undefined) return isNum(x) ? 1 : comparePart(x, '#')
    const c = comparePart(x, y)
    if (c !== 0) return c
  }
  return 0
}

export interface VersionRange {
  from: string
  fromInclusive: boolean
  to: string
  toInclusive: boolean
}

/** Valt `version` binnen het bereik? `*` betekent onbegrensd aan die kant. */
export function inRange(version: string, r: VersionRange): boolean {
  if (r.from !== '*') {
    const c = compareVersions(version, r.from)
    if (c < 0 || (c === 0 && !r.fromInclusive)) return false
  }
  if (r.to !== '*') {
    const c = compareVersions(version, r.to)
    if (c > 0 || (c === 0 && !r.toInclusive)) return false
  }
  return true
}

export const isAffected = (version: string, ranges: VersionRange[]) => ranges.some(r => inRange(version, r))
