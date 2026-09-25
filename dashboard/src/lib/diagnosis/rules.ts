import type { Locale, MessageKey, Translate } from '@/lib/i18n/core'

/** Wat de analyse ziet. Alles zonder serverpaden (de plugin maakt paden relatief: …/wp-content/…). */
export interface Evidence {
  where: 'staging' | 'production'
  items: { type: string; slug: string; name: string; from_version: string | null; to_version: string | null; status?: string | null }[]
  failures: { page: string; viewport: string; check: string; detail?: Record<string, unknown> }[]
  fatals: { message: string; file: string; line: number; uri?: string }[]
  log_tail: string[]
  environment: { wp_version?: string; php_version?: string; theme?: string; plugins?: { slug: string; name: string; version: string }[] } | null
}

export type Confidence = 'high' | 'medium' | 'low'

export interface Diagnosis {
  summary: string
  cause: string
  fix: string
  culprit_slug: string | null
  culprit_name: string | null
  confidence: Confidence
  category: string
}

type Vars = Record<string, string | number>

/** Plugin- of themamap uit een (relatief) pad of een foutmelding. */
export function componentFromPath(text: string): { kind: 'plugin' | 'theme'; dir: string } | null {
  const m = /wp-content\/(plugins|themes)\/([^/\s'"]+)\//.exec(text)
  return m ? { kind: m[1] === 'plugins' ? 'plugin' : 'theme', dir: m[2]! } : null
}

interface Classified { category: string; vars: Vars }

/** Herkent het soort fatale fout aan de melding. */
export function classifyFatal(message: string): Classified {
  const first = message.split('\n')[0] ?? message
  let m: RegExpExecArray | null
  if ((m = /Call to undefined function ([\w\\]+)\(\)/.exec(first))) return { category: 'undefined_function', vars: { fn: m[1]! } }
  if ((m = /Call to undefined method ([\w\\]+::\w+)\(\)/.exec(first))) return { category: 'undefined_method', vars: { method: m[1]! } }
  if ((m = /Class "?([\w\\]+)"? not found/.exec(first))) return { category: 'missing_class', vars: { cls: m[1]! } }
  if (/Allowed memory size of \d+ bytes exhausted/.test(first)) return { category: 'memory', vars: {} }
  if ((m = /Cannot redeclare ([\w\\]+)\(\)/.exec(first))) return { category: 'redeclare', vars: { fn: m[1]! } }
  if (/requires? (a )?PHP( version)?|Composer detected issues in your platform|PHP version ">?=?\s*\d/i.test(first)) return { category: 'php_version', vars: {} }
  if (/syntax error|Parse error/i.test(first)) return { category: 'syntax', vars: {} }
  return { category: 'fatal_other', vars: { message: first.slice(0, 200) } }
}

const CHECK_CATEGORY: Record<string, string> = {
  reachable: 'http', http: 'http', php_error: 'fatal_unknown', js_errors: 'js', resources: 'resources',
  landmarks: 'layout', content: 'layout', moving: 'layout', visual: 'visual', login: 'login',
}

function pickItem(e: Evidence, dir: string | null) {
  if (dir) return e.items.find(i => i.slug === dir || i.slug.startsWith(`${dir}/`)) ?? null
  return e.items.length === 1 ? e.items[0]! : null
}

/**
 * Regelgebaseerde diagnose: werkt altijd, ook zonder AI. Leest de vastgelegde fatale fout
 * (welke plugin, welk soort fout) of anders de eerste gezakte test, en geeft oorzaak en oplossing
 * in de taal van het bureau.
 */
export function ruleDiagnosis(e: Evidence, t: Translate, locale: Locale = 'en'): Diagnosis {
  const updated = e.items.map(i => `${i.name} ${i.to_version ?? ''}`.trim()).join(', ')
  const where = t(`diagnosis.where.${e.where}` as MessageKey)
  const base: Vars = { updated, where }
  let category: string
  let vars: Vars = {}
  let culprit: { slug: string | null; name: string | null } = { slug: null, name: null }
  let confidence: Confidence = 'medium'

  const failedItem = e.items.find(i => i.status && !['updated', 'already_current'].includes(i.status))
  const fatal = e.fatals[0]
  if (failedItem) {
    category = failedItem.status === 'filesystem_not_writable' ? 'no_write_access' : failedItem.status === 'crashed' ? 'crashed' : 'install_failed'
    vars = { status: t(`runs.itemStatus.${failedItem.status}` as MessageKey) }
    culprit = { slug: failedItem.slug, name: failedItem.name }
    confidence = 'high'
  } else if (fatal) {
    const c = classifyFatal(fatal.message)
    const comp = componentFromPath(fatal.file) ?? componentFromPath(fatal.message)
    const item = pickItem(e, comp?.dir ?? null)
    const other = comp && !item ? (e.environment?.plugins ?? []).find(p => p.slug.startsWith(`${comp.dir}/`)) : undefined
    vars = { ...c.vars, file: fatal.file.replace(/^…\//, ''), line: fatal.line }
    if (comp && !item && e.items.length) {
      // De fout zit in een plugin die níet is bijgewerkt: die werkt niet samen met de nieuwe versie.
      category = 'conflict'
      culprit = { slug: other?.slug ?? comp.dir, name: other?.name ?? comp.dir }
      vars.detail = t(`diagnosis.detail.${c.category}` as MessageKey, { ...c.vars, message: String(c.vars.message ?? '') })
      confidence = 'medium'
    } else {
      category = c.category
      const target = item ?? (e.items.length === 1 ? e.items[0]! : null)
      culprit = target ? { slug: target.slug, name: target.name } : { slug: comp?.dir ?? null, name: comp?.dir ?? null }
      confidence = item ? 'high' : 'medium'
    }
  } else {
    const f = e.failures[0]
    category = f ? CHECK_CATEGORY[f.check] ?? 'unknown' : 'unknown'
    const d = f?.detail ?? {}
    vars = {
      page: f?.page ?? '', viewport: f ? t(`runs.viewport.${f.viewport}` as MessageKey) : '',
      errors: Array.isArray(d.errors) ? d.errors.map(String).slice(0, 2).join(' · ') : '',
      resources: Array.isArray(d.resources) ? d.resources.map(String).slice(0, 3).join(', ') : '',
      status: typeof d.after === 'number' ? d.after : '',
      percent: typeof d.ratio === 'number' ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(d.ratio * 100) : '',
    }
    const target = e.items.length === 1 ? e.items[0]! : null
    culprit = target ? { slug: target.slug, name: target.name } : { slug: null, name: null }
    confidence = category === 'visual' || category === 'unknown' || !target ? 'low' : 'medium'
  }

  const plugin = culprit.name ?? updated
  const item = e.items.find(i => i.slug === culprit.slug)
  const all: Vars = { ...base, ...vars, plugin, from: item?.from_version ?? '', to: item?.to_version ?? '' }
  return {
    summary: t(`diagnosis.${category}.summary` as MessageKey, all),
    cause: t(`diagnosis.${category}.cause` as MessageKey, all),
    fix: t(`diagnosis.${category}.fix` as MessageKey, all),
    culprit_slug: culprit.slug,
    culprit_name: culprit.name,
    confidence,
    category,
  }
}
