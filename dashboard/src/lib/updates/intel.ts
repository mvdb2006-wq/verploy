/**
 * Wat Verploy over een versie weet van alle sites samen (update_intel): zonder problemen live gezet op
 * zoveel sites, of op zoveel sites misgegaan. Pas vanaf een paar sites zeggen de cijfers iets.
 */
export interface Intel { ok: number; failed: number }
export type IntelVerdict = 'proven' | 'mixed' | 'risky'

/** Minimaal aantal sites voordat Verploy er iets over zegt. */
export const MIN_SITES = 3

export const intelKey = (type: string, slug: string, version: string) => `${type}:${slug}:${version}`

export function intelVerdict(i: Intel | null | undefined): IntelVerdict | null {
  if (!i) return null
  const total = i.ok + i.failed
  if (total < MIN_SITES) return null
  if (i.failed === 0) return 'proven'
  // Meerdere sites en minstens een kwart misgegaan: dit ligt waarschijnlijk aan de versie zelf.
  if (i.failed >= 2 && i.failed / total >= 0.25) return 'risky'
  return 'mixed'
}

export function intelMap(rows: Array<{ type: string; slug: string; version: string; ok_sites: number; failed_sites: number }>): Map<string, Intel> {
  return new Map(rows.map(r => [intelKey(r.type, r.slug, r.version), { ok: r.ok_sites, failed: r.failed_sites }]))
}
