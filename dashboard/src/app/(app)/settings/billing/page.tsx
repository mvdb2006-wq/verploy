import { Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { agencyIsWritable, requireAgency } from '@/lib/session'
import { formatDate } from '@/lib/format'
import { DATE_LOCALE_TAG } from '@/lib/i18n/core'
import { billingEnabled } from '@/lib/billing/stripe'
import { Alert } from '@/components/Alert'
import { AutoRefresh } from '@/components/AutoRefresh'
import { cn } from '@/lib/cn'
import { CancelToggle, PlanButton } from './forms'
import { openPortal } from './actions'
import { pickPlan } from '@/lib/signup-intent'

export async function generateMetadata() {
  return { title: (await getT())('billing.title') }
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; plan?: string }> }) {
  const session = await requireAgency()
  const { checkout, plan: planParam } = await searchParams
  const [t, locale, supabase] = await Promise.all([getT(), getLocale(), createClient()])
  const { data: plans } = await supabase.from('plans').select('id, name, price_cents, currency, sites_limit').eq('is_public', true).order('sort_order')
  const a = session.agency
  const owner = session.role === 'owner'
  const enabled = billingEnabled()
  const subscribed = Boolean(a.stripe_subscription_id) && (a.plan_status === 'active' || a.plan_status === 'past_due')
  const money = (cents: number, currency: string) => new Intl.NumberFormat(DATE_LOCALE_TAG[locale], { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100)
  const trialOver = a.plan_status === 'trialing' && !agencyIsWritable(a)
  // Het plan dat de gebruiker op verploy.com koos (?plan=, of bewaard bij zijn account bij registratie):
  // alleen een voorselectie, getoetst aan de openbare plannen. Niet bij een lopend of gratis abonnement.
  const intended = !subscribed && a.plan_status !== 'comped'
    ? pickPlan(planParam, plans ?? []) ?? pickPlan(session.user.user_metadata?.intended_plan, plans ?? [])
    : null
  const status = a.plan_status === 'comped' ? t('billing.status.comped')
    : a.plan_status === 'trialing' ? (trialOver ? t('billing.status.trialEnded') : t('billing.status.trialing', { date: formatDate(a.trial_ends_at, locale) }))
    : a.plan_status === 'past_due' ? t('billing.status.past_due')
    : a.plan_status === 'canceled' ? t('billing.status.canceled')
    : a.subscription_cancel_at_end && a.subscription_period_end ? t('billing.status.cancels', { date: formatDate(a.subscription_period_end, locale) })
    : a.subscription_period_end ? `${t('billing.status.active')} · ${t('billing.status.renews', { date: formatDate(a.subscription_period_end, locale) })}`
    : t('billing.status.active')

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {checkout === 'success' && !subscribed && <AutoRefresh seconds={2} />}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('billing.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('billing.intro')}</p>
      </div>
      {checkout === 'success' && <Alert tone="ok">{t('billing.success')}</Alert>}
      <Alert tone={a.plan_status === 'past_due' || a.plan_status === 'canceled' || trialOver ? 'warn' : 'info'}>{status}</Alert>
      {!enabled && <Alert tone="info">{t('billing.notConfigured')}</Alert>}
      {enabled && !owner && <p className="text-sm text-muted">{t('billing.ownerOnly')}</p>}

      {intended && enabled && owner && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-(--radius-card) border border-accent/40 bg-accent/5 px-5 py-4" aria-labelledby="intended-title">
          <div className="min-w-0 flex-1 basis-64">
            <h2 id="intended-title" className="font-bold">{t('billing.intended.title', { plan: intended.name })}</h2>
            <p className="mt-0.5 text-sm text-muted">{t('billing.intended.body', { price: money(intended.price_cents, intended.currency), count: intended.sites_limit })}</p>
          </div>
          <div className="w-full sm:w-auto"><PlanButton plan={intended.id} mode="checkout" label={t('billing.intended.cta', { plan: intended.name })} /></div>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(plans ?? []).map(p => {
          const current = p.id === a.plan_id && (subscribed || a.plan_status === 'comped')
          const chosen = intended?.id === p.id
          return (
            <section key={p.id} className={cn('flex flex-col rounded-(--radius-card) border bg-surface p-5', current || chosen ? 'border-accent' : 'border-border')} aria-labelledby={`plan-${p.id}`} data-chosen={chosen || undefined}>
              <div className="flex items-center justify-between gap-2">
                <h2 id={`plan-${p.id}`} className="font-bold">{p.name}</h2>
                {current && <span className="badge badge-ok"><Check size={12} aria-hidden /> {t('billing.currentBadge')}</span>}
                {chosen && <span className="badge badge-ok">{t('billing.intended.badge')}</span>}
              </div>
              <p className="mt-3 text-3xl font-extrabold tabular-nums">{money(p.price_cents, p.currency)}</p>
              <p className="text-xs text-muted">{t('billing.perMonth')}</p>
              <p className="mt-3 text-sm">{t('billing.sites', { count: p.sites_limit })}</p>
              <div className="mt-auto pt-5">
                {enabled && owner && !current && a.plan_status !== 'comped' && (
                  <PlanButton plan={p.id} mode={subscribed ? 'change' : 'checkout'} label={subscribed ? t('billing.switch') : t('billing.choose')} />
                )}
              </div>
            </section>
          )
        })}
      </div>

      {enabled && owner && (subscribed || a.stripe_customer_id) && (
        <section className="card flex flex-wrap items-start justify-between gap-6">
          {subscribed && <CancelToggle cancelling={a.subscription_cancel_at_end} />}
          {a.stripe_customer_id && (
            <form action={openPortal}>
              <button type="submit" className="btn btn-ghost">{t('billing.portal')}</button>
            </form>
          )}
        </section>
      )}
    </div>
  )
}
