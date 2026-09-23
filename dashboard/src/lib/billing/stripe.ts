import 'server-only'
import Stripe from 'stripe'
import { env } from '@/lib/env'

let client: Stripe | null = null

/** Stripe-client, of null als Stripe (nog) niet is ingesteld (BLOCKERS #7). */
export function stripe(): Stripe | null {
  const e = env()
  if (!e.STRIPE_SECRET_KEY) return null
  if (!client) {
    const base = e.STRIPE_API_BASE ? new URL(e.STRIPE_API_BASE) : null
    client = new Stripe(e.STRIPE_SECRET_KEY, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: 'Verploy', url: 'https://app.verploy.com' },
      ...(base ? { host: base.hostname, port: Number(base.port || (base.protocol === 'https:' ? 443 : 80)), protocol: base.protocol.replace(':', '') as 'http' | 'https' } : {}),
    })
  }
  return client
}

export function billingEnabled(): boolean {
  return Boolean(env().STRIPE_SECRET_KEY)
}
