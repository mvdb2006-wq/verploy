import Link from 'next/link'
import { getLocale, getT } from '@/lib/i18n/server'
import { DATE_LOCALE_TAG } from '@/lib/i18n/core'
import { safeNext } from '@/lib/safe-next'
import { publicPlans } from '@/lib/billing/public-plans'
import { pickPlan } from '@/lib/signup-intent'
import { SignupForm } from '../forms'

export async function generateMetadata() {
  return { title: (await getT())('auth.signup.title') }
}

/** Proefperiode = het standaardplan van een nieuw bureau (agencies.plan_id default, DECISIONS.md). */
const TRIAL_PLAN = 'studio'

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const [t, locale, plans] = await Promise.all([getT(), getLocale(), publicPlans()])
  const next = safeNext(sp.next, '/onboarding')
  // Gekozen op verploy.com (?plan=): alleen een bestaand, openbaar plan; anders gewoon geen keuze.
  const plan = pickPlan(sp.plan, plans)
  // Heeft de bezoeker al een account? Na het inloggen meteen naar het abonnement met dit plan.
  const loginNext = plan && next === '/onboarding' ? `/settings/billing?plan=${plan.id}` : next
  const trialLimit = plans.find(p => p.id === TRIAL_PLAN)?.sites_limit ?? null
  const price = plan ? new Intl.NumberFormat(DATE_LOCALE_TAG[locale], { style: 'currency', currency: plan.currency.toUpperCase(), maximumFractionDigits: 0 }).format(plan.price_cents / 100) : ''
  return (
    <section>
      <h1 className="text-2xl font-extrabold tracking-tight">{t('auth.signup.title')}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{t('auth.signup.subtitle')}</p>
      {plan && (
        <aside className="mb-6 rounded-(--radius-card) border border-accent/40 bg-accent/5 px-4 py-3 text-sm" aria-label={t('auth.signup.plan.label')}>
          <p className="font-bold">{t('auth.signup.plan.chosen', { plan: plan.name })}</p>
          <p className="mt-0.5 text-muted">{t('auth.signup.plan.detail', { price, count: plan.sites_limit })}</p>
          <p className="mt-2 text-muted">{t('auth.signup.plan.trial')}</p>
          {trialLimit !== null && plan.sites_limit > trialLimit && (
            <p className="mt-1 text-muted">{t('auth.signup.plan.trialLimit', { trial: trialLimit, count: plan.sites_limit, plan: plan.name })}</p>
          )}
        </aside>
      )}
      <SignupForm next={next} defaultEmail={sp.email} plan={plan?.id ?? null} />
      <p className="mt-8 text-sm text-muted">
        {t('auth.signup.haveAccount')}{' '}
        <Link href={`/login${loginNext !== '/onboarding' ? `?next=${encodeURIComponent(loginNext)}` : ''}`} className="font-semibold text-accent hover:underline">
          {t('auth.signup.loginLink')}
        </Link>
      </p>
    </section>
  )
}
