'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { dbErrorKey } from '@/lib/db-errors'
import { periodFor, type PeriodChoice } from '@/lib/reports/period'

export interface ReportState { error?: string; ok?: string }

export async function createReport(_: ReportState, form: FormData): Promise<ReportState> {
  const t = await getT()
  const siteId = String(form.get('site_id') ?? '')
  const choice = String(form.get('period') ?? 'lastMonth') as PeriodChoice
  const period = periodFor(choice, String(form.get('from') ?? ''), String(form.get('to') ?? ''))
  if (!period) return { error: t('reports.errors.invalid_period') }
  const supabase = await createClient()
  const { error } = await supabase.rpc('request_report', { p_site: siteId, p_start: period.start, p_end: period.end, p_send: form.get('send') === 'on' })
  if (error) return { error: t(dbErrorKey(error)) }
  revalidatePath('/reports')
  return { ok: t('reports.create.created') }
}
