import 'server-only'
import { z } from 'zod'

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.url().default('https://app.verploy.com'),
  /** Optioneel: eigen sleutel (32 bytes, base64) voor site-secrets. Zonder deze
   *  wordt een sleutel afgeleid van de service-role-key (zie DECISIONS.md). */
  VERPLOY_ENCRYPTION_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default('Verploy <noreply@verploy.com>'),
  CRON_SECRET: z.string().optional(),
  /** Stripe (fase 7). Zonder sleutel is afrekenen uitgeschakeld en blijft het bureau op zijn huidige plan. */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** Klantportaal-configuratie (uitvoer van scripts/stripe-setup.mjs). */
  STRIPE_PORTAL_CONFIGURATION: z.string().optional(),
  /** Alleen voor tests: stripe-mock, bijv. http://127.0.0.1:12111 */
  STRIPE_API_BASE: z.url().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
      const missing = parsed.error.issues.map(i => i.path.join('.')).join(', ')
      throw new Error(`Ongeldige of ontbrekende omgevingsvariabelen: ${missing}`)
    }
    cached = parsed.data
  }
  return cached
}
