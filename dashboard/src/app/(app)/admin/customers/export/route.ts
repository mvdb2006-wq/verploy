import { getLocale, getT } from '@/lib/i18n/server'
import { formatDate } from '@/lib/format'
import type { MessageKey } from '@/lib/i18n/core'
import { customersCsv } from '@/lib/admin/customers'
import { loadCustomers } from '@/lib/admin/load'

export const dynamic = 'force-dynamic'

/** CSV van het klantoverzicht (alleen de beheerder van Verploy; anderen krijgen 404). */
export async function GET() {
  const [{ customers }, t, locale] = await Promise.all([loadCustomers(), getT(), getLocale()])
  const csv = customersCsv(customers, s => s === 'trial' ? t('admin.kpi.trials') : t(`admin.status.${s}` as MessageKey))
  const name = `verploy-klanten-${formatDate(new Date().toISOString(), locale).replace(/\W+/g, '-')}.csv`
  return new Response('﻿' + csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' } })
}
