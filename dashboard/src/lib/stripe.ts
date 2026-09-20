import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
  typescript: true,
})

// Price IDs — create these in Stripe Dashboard → Products
// Then add to .env.local
export const STRIPE_PRICES = {
  starter_monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY!,
  starter_yearly:  process.env.STRIPE_PRICE_STARTER_YEARLY!,
  agency_monthly:  process.env.STRIPE_PRICE_AGENCY_MONTHLY!,
  agency_yearly:   process.env.STRIPE_PRICE_AGENCY_YEARLY!,
  pro_monthly:     process.env.STRIPE_PRICE_PRO_MONTHLY!,
  pro_yearly:      process.env.STRIPE_PRICE_PRO_YEARLY!,
} as const

export type PlanId = 'starter' | 'agency' | 'pro'
export type BillingInterval = 'monthly' | 'yearly'

export function getPriceId(plan: PlanId, interval: BillingInterval): string {
  const key = `${plan}_${interval}` as keyof typeof STRIPE_PRICES
  return STRIPE_PRICES[key]
}

export const PLAN_NAMES: Record<PlanId, string> = {
  starter: 'Starter',
  agency:  'Agency',
  pro:     'Pro',
}

export const PLAN_PRICES: Record<PlanId, { monthly: number; yearly: number }> = {
  starter: { monthly: 29,  yearly: 278 },  // 20% off
  agency:  { monthly: 79,  yearly: 758 },
  pro:     { monthly: 199, yearly: 1910 },
}
