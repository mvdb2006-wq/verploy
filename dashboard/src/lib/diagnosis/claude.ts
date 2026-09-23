import { z } from 'zod'
import type { Locale } from '@/lib/i18n/core'
import type { Diagnosis, Evidence } from './rules'

export const DEFAULT_MODEL = 'claude-sonnet-5'
const API_URL = 'https://api.anthropic.com/v1/messages'

const LANGUAGE: Record<Locale, string> = { nl: 'Dutch', en: 'English', de: 'German', fr: 'French', es: 'Spanish' }

/** JSON-schema voor structured outputs (zonder lengte-/patroonregels: die ondersteunt de API niet). */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One sentence, max ~160 characters: what broke and why.' },
    cause: { type: 'string', description: 'Two to four sentences explaining the cause, based only on the evidence.' },
    fix: { type: 'string', description: 'Concrete next steps for the agency, as short sentences.' },
    culprit_slug: { type: 'string', description: 'Plugin/theme slug from the evidence that causes the failure, or an empty string if unknown.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['summary', 'cause', 'fix', 'culprit_slug', 'confidence'],
  additionalProperties: false,
} as const

const outputSchema = z.object({
  summary: z.string().trim().min(1).max(400),
  cause: z.string().trim().min(1).max(2000),
  fix: z.string().trim().min(1).max(2000),
  culprit_slug: z.string().max(255),
  confidence: z.string().transform(s => s.toLowerCase()).pipe(z.enum(['high', 'medium', 'low'])),
})

export function buildPrompt(evidence: Evidence, draft: Diagnosis, locale: Locale): { system: string; user: string } {
  const system = [
    'You are the failure-diagnosis assistant of Verploy, a service that tests WordPress updates on a staging copy before they go live and rolls back updates that break the live site.',
    'Your reader is a developer or project manager at a web agency. Explain in plain, calm language what went wrong and what to do next.',
    `Write summary, cause and fix in ${LANGUAGE[locale]}.`,
    'Rules: use only facts from the evidence; if something is a likely explanation rather than certain, say so; never invent file names, functions, versions or changelog entries;',
    'name the plugin or theme that causes the failure when the evidence shows it (the file path of a fatal error is the strongest signal);',
    'distinguish between "the updated plugin itself is broken" and "the update conflicts with another plugin or with the PHP version";',
    'the fix must be actionable (for example: keep the current version, update another plugin first, contact the plugin author with the error message, raise the memory limit), and must mention that nothing was changed on the live site when the evidence says the failure happened on staging.',
    'A rule-based draft is provided; improve it when the evidence supports more, otherwise keep its conclusion.',
  ].join(' ')
  const user = JSON.stringify({ evidence, rule_based_draft: { summary: draft.summary, cause: draft.cause, fix: draft.fix, culprit_slug: draft.culprit_slug, confidence: draft.confidence } }, null, 1)
  return { system, user }
}

export class DiagnosisApiError extends Error {}

/**
 * Verfijnt de regelgebaseerde diagnose met Claude (structured outputs). Gooit een
 * DiagnosisApiError bij een API-fout, weigering of ongeldig antwoord; de aanroeper valt dan
 * terug op de regelgebaseerde diagnose.
 */
export async function refineWithClaude(
  evidence: Evidence, draft: Diagnosis, locale: Locale,
  opts: { apiKey: string; model?: string; fetch?: typeof fetch; timeoutMs?: number },
): Promise<Diagnosis & { model: string }> {
  const model = opts.model || DEFAULT_MODEL
  const { system, user } = buildPrompt(evidence, draft, locale)
  const f = opts.fetch ?? fetch
  let res: Response
  try {
    res = await f(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    })
  } catch (err) {
    throw new DiagnosisApiError(`network: ${(err as Error).message}`)
  }
  const body = await res.json().catch(() => null) as { stop_reason?: string; content?: { type: string; text?: string }[]; error?: { message?: string } } | null
  if (!res.ok || !body) throw new DiagnosisApiError(`HTTP ${res.status}: ${body?.error?.message ?? 'no body'}`)
  if (body.stop_reason !== 'end_turn') throw new DiagnosisApiError(`stop_reason ${body.stop_reason}`)
  const text = body.content?.find(c => c.type === 'text')?.text ?? ''
  let parsed
  try {
    parsed = outputSchema.parse(JSON.parse(text))
  } catch {
    throw new DiagnosisApiError('invalid structured output')
  }
  // Alleen een plugin/thema noemen die echt in het bewijs voorkomt.
  const known = new Set([...evidence.items.map(i => i.slug), ...(evidence.environment?.plugins ?? []).map(p => p.slug)])
  const slug = parsed.culprit_slug && [...known].find(k => k === parsed.culprit_slug || k.startsWith(`${parsed.culprit_slug}/`))
  const name = slug ? evidence.items.find(i => i.slug === slug)?.name ?? evidence.environment?.plugins?.find(p => p.slug === slug)?.name ?? null : null
  return {
    summary: parsed.summary, cause: parsed.cause, fix: parsed.fix,
    culprit_slug: slug || draft.culprit_slug, culprit_name: name ?? draft.culprit_name,
    confidence: parsed.confidence, category: draft.category, model,
  }
}
