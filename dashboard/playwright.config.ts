import { defineConfig } from '@playwright/test'

/**
 * E2E tegen een lokale omgeving. Playwright start zelf de mock-e-mailserver en
 * `next start` (na `next build`); de lokale Supabase-stack (supabase/local/start.sh)
 * en een test-WordPress (E2E_WP_URL, met Verploy Connector actief) moeten draaien.
 */
const CRON_SECRET = process.env.E2E_CRON_SECRET ?? 'e2e-local-cron-secret'
const MOCK_RESEND_PORT = process.env.MOCK_RESEND_PORT ?? '4010'
const STRIPE_MOCK_PORT = process.env.STRIPE_MOCK_PORT ?? '12111'
const MOCK_WORDFENCE_PORT = process.env.MOCK_WORDFENCE_PORT ?? '4030'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    locale: 'nl-NL',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      // Officiële Stripe-API-mock (github.com/stripe/stripe-mock)
      command: `${process.env.STRIPE_MOCK_BIN ?? 'stripe-mock'} -http-port ${STRIPE_MOCK_PORT}`,
      port: Number(STRIPE_MOCK_PORT),
      reuseExistingServer: true,
    },
    {
      command: 'node e2e/support/mock-resend.mjs',
      url: `http://127.0.0.1:${MOCK_RESEND_PORT}/health`,
      env: { MOCK_RESEND_PORT },
      reuseExistingServer: false,
    },
    {
      command: 'node e2e/support/mock-wordfence.mjs',
      url: `http://127.0.0.1:${MOCK_WORDFENCE_PORT}/health`,
      env: { MOCK_WORDFENCE_PORT },
      reuseExistingServer: false,
    },
    {
      command: 'npx next start -p 3000 -H 127.0.0.1',
      url: 'http://127.0.0.1:3000/login',
      reuseExistingServer: false,
      env: {
        RESEND_API_KEY: 're_e2e_local',
        RESEND_BASE_URL: `http://127.0.0.1:${MOCK_RESEND_PORT}`,
        CRON_SECRET,
        STRIPE_SECRET_KEY: 'sk_test_e2e',
        STRIPE_WEBHOOK_SECRET: process.env.E2E_STRIPE_WEBHOOK_SECRET ?? 'whsec_e2e_local',
        STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_MOCK_PORT}`,
      },
    },
    {
      // Worker voor de kernflow (vooraf: npm run worker:build)
      command: 'node --env-file=.env.local worker/dist/main.mjs',
      url: 'http://127.0.0.1:4020/',
      reuseExistingServer: false,
      stdout: 'pipe',
      env: {
        WORKER_ID: 'e2e-worker',
        WORKER_HEALTH_PORT: '4020',
        WORKER_POLL_MS: '1000',
        WORKER_MAINTENANCE_MS: '3600000',
        WORKER_VULN_MS: '2000',
        WORKER_SCHEDULE_MS: '3000',
        WORDFENCE_API_KEY: 'wf_e2e_local',
        WORDFENCE_FEED_URL: `http://127.0.0.1:${MOCK_WORDFENCE_PORT}/api/intelligence/v3/vulnerabilities/production`,
        RESEND_API_KEY: 're_e2e_local',
        RESEND_BASE_URL: `http://127.0.0.1:${MOCK_RESEND_PORT}`,
        NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
        ...(process.env.PW_CHROMIUM_PATH ? { PLAYWRIGHT_CHROMIUM_PATH: process.env.PW_CHROMIUM_PATH } : {}),
      },
    },
  ],
})
