'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { requireAgency } from '@/lib/session'
import { normalizeSiteUrl } from '@/lib/url'
import { dbErrorKey } from '@/lib/db-errors'
import { LOCALES } from '@/lib/i18n/core'

export interface NewSiteState { error?: string; fields?: Record<string, string> }

export async function createSite(_: NewSiteState, form: FormData): Promise<NewSiteState> {
  const session = await requireAgency()
  const t = await getT()
  const fields = Object.fromEntries(['name', 'url', 'client_name', 'client_email', 'report_locale'].map(k => [k, String(form.get(k) ?? '').trim()]))
  const url = normalizeSiteUrl(fields.url ?? '')
  if (!fields.name) return { error: t('sitesNew.errorName'), fields }
  if (!url) return { error: t('sitesNew.errorUrl'), fields }
  if (fields.client_email && !z.email().safeParse(fields.client_email).success) return { error: t('sitesNew.errorEmail'), fields }
  const locale = (LOCALES as readonly string[]).includes(fields.report_locale ?? '') ? fields.report_locale! : session.agency.dashboard_locale

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sites')
    .insert({
      agency_id: session.agency.id,
      name: fields.name.slice(0, 120),
      url,
      client_name: fields.client_name || null,
      client_email: fields.client_email?.toLowerCase() || null,
      report_locale: locale,
    })
    .select('id')
    .single()
  if (error) {
    const key = dbErrorKey(error)
    if (key === 'sitesNew.errorLimit') {
      const { data: plan } = await supabase.from('plans').select('name, sites_limit').eq('id', session.agency.plan_id).single()
      return { error: t(key, { plan: plan?.name ?? '', limit: plan?.sites_limit ?? '' }), fields }
    }
    return { error: t(key === 'common.errorForbidden' ? 'sitesNew.errorForbidden' : key), fields }
  }
  redirect(`/sites/${data.id}?pair=1`)
}
