import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { canManage, requireAgency } from '@/lib/session'
import { formatDate } from '@/lib/format'
import { AgencyForm, LogoForm } from './form'

export async function generateMetadata() {
  return { title: (await getT())('settings.title') }
}

export default async function SettingsPage() {
  const session = await requireAgency()
  const [t, locale, supabase] = await Promise.all([getT(), getLocale(), createClient()])
  const [{ data: plan }, { count }] = await Promise.all([
    supabase.from('plans').select('name, sites_limit').eq('id', session.agency.plan_id).single(),
    supabase.from('sites').select('id', { count: 'exact', head: true }),
  ])
  const a = session.agency
  const statusLine = a.plan_status === 'comped' ? t('settings.planComped')
    : a.plan_status === 'trialing' && a.trial_ends_at ? t('settings.planTrial', { date: formatDate(a.trial_ends_at, locale) })
    : t('settings.planActive')
  const used = count ?? 0
  const limit = plan?.sites_limit ?? 0

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('settings.title')}</h1>
      <AgencyForm
        disabled={!canManage(session.role)}
        defaults={{ name: a.name, dashboard_locale: a.dashboard_locale, brand_color: a.brand_color, report_sender_name: a.report_sender_name ?? '' }}
      />
      <LogoForm hasLogo={Boolean(a.brand_logo_path)} disabled={!canManage(session.role)} />
      <section className="card" aria-labelledby="plan-title">
        <h2 id="plan-title" className="font-bold">{t('settings.planTitle')}</h2>
        <p className="mt-2 text-sm">{t('settings.planLine', { plan: plan?.name ?? a.plan_id, limit })}</p>
        <p className="text-sm text-muted">{statusLine}</p>
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}
            aria-label={t('settings.usage', { used, limit })}>
            <div className="h-full rounded-full bg-accent" style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 0}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted tabular-nums">{t('settings.usage', { used, limit })}</p>
        </div>
      </section>
    </div>
  )
}
