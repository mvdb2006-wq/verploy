'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canManage, requireAgency } from '@/lib/session'
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

/**
 * Verwijdert een rapport (record én PDF). Alleen eigenaren en beheerders; het rapport moet via RLS
 * zichtbaar zijn (eigen bureau). Eerst de PDF, dan het record: mislukt de opslag, dan blijft alles staan.
 */
export async function deleteReport(_: ReportState, form: FormData): Promise<ReportState> {
  const session = await requireAgency()
  const t = await getT()
  if (!canManage(session.role)) return { error: t('common.errorForbidden') }
  const id = String(form.get('report_id') ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: t('common.errorGeneric') }
  const supabase = await createClient()
  const { data: report } = await supabase.from('reports').select('id, agency_id, status, pdf_path').eq('id', id).maybeSingle()
  if (!report || report.agency_id !== session.agency.id) return { error: t('common.errorGeneric') }
  if (report.status === 'generating') return { error: t('reports.errors.delete_busy') }
  const admin = createAdminClient()
  if (report.pdf_path) {
    const { error } = await admin.storage.from('reports').remove([report.pdf_path])
    if (error) {
      console.error(JSON.stringify({ msg: 'report_delete_storage_failed', report: id, error: error.message }))
      return { error: t('reports.errors.delete_storage') }
    }
  }
  const { error } = await admin.from('reports').delete().eq('id', id).eq('agency_id', session.agency.id)
  if (error) return { error: t('common.errorGeneric') }
  console.info(JSON.stringify({ msg: 'report_deleted', report: id, agency: session.agency.id, user: session.user.id }))
  revalidatePath('/reports')
  return { ok: t('reports.deleted') }
}
