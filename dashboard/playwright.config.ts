import { defineConfig } from '@playwright/test'

/**
 * E2E tegen een draaiende lokale omgeving:
 *   - dashboard:  E2E_BASE_URL (standaard http://127.0.0.1:3000, `next start`)
 *   - WordPress:  E2E_WP_URL   (standaard http://127.0.0.1:8088, met Verploy Connector actief)
 * Zie README → "Lokaal testen".
 */
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
})
