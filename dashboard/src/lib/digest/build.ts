/**
 * Ochtendmail "Afgelopen nacht": wat Verploy deed en wat op het bureau wacht, in gewone taal.
 * Puur (geen I/O): de worker haalt de gegevens op, dit maakt er de mail van. Niets te melden → null.
 */
import type { Translate } from '@/lib/i18n/core'
import { summarizeRun, type RunItem } from '@/lib/run-items'
import { presentReason } from '@/lib/runs'

export interface DigestRun {
  siteName: string
  status: string
  verdict: string | null
  trigger: string
  items: RunItem[]
  reasonKey: string | null
  reasonParams: unknown
}

export interface DigestInput {
  agencyName: string
  runs: DigestRun[]
  /** Beslissingen in de inbox (vraag om akkoord, lek met een klaarstaande oplossing). */
  decisions: number
  /** Problemen in de inbox (site offline, certificaat, tegengehouden update, …). */
  problems: number
}

export interface Digest {
  subject: string
  heading: string
  intro: string
  sections: Array<{ title: string; lines: string[] }>
  cta: string
}

const label = (i: RunItem) => (i.to_version ? `${i.name} ${i.to_version}` : i.name)

export function buildDigest(t: Translate, d: DigestInput): Digest | null {
  const done = d.runs.filter(r => r.status === 'done')
  const liveLines: string[] = []
  const heldLines: string[] = []
  let live = 0
  let held = 0
  for (const r of done) {
    const s = summarizeRun(r.items, r)
    if (s.live.length) {
      live += s.live.length
      liveLines.push(t('digest.line', { site: r.siteName, items: s.live.map(label).join(', ') }))
    }
    const notLive = [...s.attention, ...s.heldBack, ...s.rolledBack, ...s.skipped]
    if (notLive.length) {
      held += notLive.length
      const reason = presentReason(t, r.reasonKey, r.reasonParams)
      heldLines.push(t(reason ? 'digest.lineReason' : 'digest.line', { site: r.siteName, items: notLive.map(label).join(', '), reason }))
    }
  }
  const waiting = d.decisions + d.problems
  if (!live && !held && !waiting) return null

  const sections: Digest['sections'] = []
  if (liveLines.length) sections.push({ title: t('digest.live', { count: live }), lines: liveLines })
  if (heldLines.length) sections.push({ title: t('digest.held', { count: held }), lines: heldLines })
  if (waiting) {
    sections.push({ title: t('digest.waiting', { count: waiting }), lines: [
      ...(d.decisions ? [t('digest.decisions', { count: d.decisions })] : []),
      ...(d.problems ? [t('digest.problems', { count: d.problems })] : []),
    ] })
  }
  const subject = live || held
    ? t('digest.subject', { agency: d.agencyName, live, held })
    : t('digest.subjectWaiting', { agency: d.agencyName, count: waiting })
  return {
    subject,
    heading: t('digest.heading', { agency: d.agencyName }),
    intro: live || held ? t('digest.intro') : t('digest.introQuiet'),
    sections,
    cta: t(waiting ? 'digest.ctaInbox' : 'digest.ctaOverview'),
  }
}
