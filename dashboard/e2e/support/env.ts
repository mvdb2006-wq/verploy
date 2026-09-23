import pg from 'pg'

export const WP = process.env.E2E_WP_URL ?? 'http://127.0.0.1:8088'
export const WP_USER = process.env.E2E_WP_USER ?? 'admin'
export const WP_PASS = process.env.E2E_WP_PASS ?? 'adminpass123'
export const MOCK_RESEND = `http://127.0.0.1:${process.env.MOCK_RESEND_PORT ?? 4010}`
export const CRON_SECRET = process.env.E2E_CRON_SECRET ?? 'e2e-local-cron-secret'

/** Directe databasetoegang voor "tijdreizen" in tests (bijv. een heartbeat 2 uur terugzetten). */
export function db() {
  return new pg.Client({ host: process.env.TEST_PG_HOST ?? '/tmp', port: Number(process.env.TEST_PG_PORT ?? 54322), user: 'postgres',
    password: process.env.TEST_PG_PASSWORD, database: process.env.E2E_DB_NAME ?? 'verploy_dev' })
}

export interface SentMail { id: string; to: string[]; subject: string; text: string; html: string; from: string }
export async function sentMails(): Promise<SentMail[]> {
  return (await (await fetch(`${MOCK_RESEND}/__sent`)).json()) as SentMail[]
}
export async function clearMails(): Promise<void> {
  await fetch(`${MOCK_RESEND}/__sent`, { method: 'DELETE' })
}
