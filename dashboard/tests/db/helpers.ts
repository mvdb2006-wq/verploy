import pg from 'pg'
import { randomUUID } from 'node:crypto'

export const pool = new pg.Pool({
  host: process.env.TEST_PG_HOST ?? '/tmp',
  port: Number(process.env.TEST_PG_PORT ?? 54322),
  user: 'postgres',
  password: process.env.TEST_PG_PASSWORD,
  database: process.env.TEST_DB_NAME ?? 'verploy_test',
  max: 4,
})

export type Db = pg.PoolClient

/** Draait fn in een transactie die altijd wordt teruggedraaid: tests laten niets achter. */
export async function inTx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect()
  try {
    await db.query('begin')
    return await fn(db)
  } finally {
    await db.query('rollback').catch(() => undefined)
    db.release()
  }
}

/** Zet de sessie in dezelfde toestand als PostgREST doet voor een request. */
export async function actAs(db: Db, who: { role: 'anon' } | { role: 'authenticated'; id: string; email: string } | { role: 'service_role' }) {
  await db.query('reset role')
  const claims =
    who.role === 'authenticated'
      ? { sub: who.id, role: 'authenticated', email: who.email, aud: 'authenticated' }
      : { role: who.role }
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
  await db.query(`set local role ${who.role}`)
}

export async function asSuper(db: Db) {
  await db.query('reset role')
  await db.query(`select set_config('request.jwt.claims', '', true)`)
}

/** Verwacht dat de query faalt; geeft de Postgres-foutcode + melding terug. */
export async function expectError(db: Db, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await db.query('savepoint expect_error')
  try {
    await db.query(sql, params)
  } catch (err) {
    await db.query('rollback to savepoint expect_error')
    const e = err as { code: string; message: string }
    return { code: e.code, message: e.message }
  }
  await db.query('release savepoint expect_error')
  throw new Error(`Query had moeten falen maar slaagde: ${sql}`)
}

export interface User { id: string; email: string }
export interface Agency { id: string; owner: User; admin: User; member: User; siteIds: string[] }

async function createUser(db: Db, label: string): Promise<User> {
  const id = randomUUID()
  const email = `${label}-${id.slice(0, 8)}@example.test`
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, 'x', now(), now(), now())`,
    [id, email],
  )
  return { id, email }
}

/** Maakt een compleet bureau (owner/admin/member, 2 sites, snapshots, componenten) als superuser. */
export async function seedAgency(db: Db, label: string, opts: { plan?: string; planStatus?: string; trialEndsAt?: string | null } = {}): Promise<Agency> {
  await asSuper(db)
  const owner = await createUser(db, `${label}-owner`)
  const admin = await createUser(db, `${label}-admin`)
  const member = await createUser(db, `${label}-member`)
  const { rows: [ag] } = await db.query<{ id: string }>(
    `insert into public.agencies (name, slug, plan_id, plan_status, trial_ends_at)
     values ($1, $2, $3, $4, $5) returning id`,
    [`Bureau ${label}`, `bureau-${label}-${randomUUID().slice(0, 6)}`, opts.plan ?? 'studio',
     opts.planStatus ?? 'active', opts.trialEndsAt === undefined ? null : opts.trialEndsAt],
  )
  for (const [u, role] of [[owner, 'owner'], [admin, 'admin'], [member, 'member']] as const) {
    await db.query(`insert into public.agency_members (agency_id, user_id, role) values ($1, $2, $3)`, [ag.id, u.id, role])
  }
  const siteIds: string[] = []
  for (let i = 1; i <= 2; i++) {
    const { rows: [s] } = await db.query<{ id: string }>(
      `insert into public.sites (agency_id, name, url) values ($1, $2, $3) returning id`,
      [ag.id, `Site ${label}${i}`, `https://${label}${i}-${randomUUID().slice(0, 6)}.example`],
    )
    siteIds.push(s.id)
    await db.query(
      `insert into public.health_snapshots (agency_id, site_id, php_version, raw) values ($1, $2, '8.3.0', '{}')`,
      [ag.id, s.id],
    )
    await db.query(
      `insert into public.site_components (agency_id, site_id, type, slug, name, version) values ($1, $2, 'plugin', 'akismet/akismet.php', 'Akismet', '5.0')`,
      [ag.id, s.id],
    )
    await db.query(`update public.site_credentials set secret_ciphertext = 'ciphertext-${label}${i}' where site_id = $1`, [s.id])
    await db.query(`insert into public.signed_request_nonces (site_id, nonce) values ($1, $2)`, [s.id, randomUUID().replaceAll('-', '')])
  }
  // Eén afgeronde update-run met tijdlijn en testresultaat (voor de RLS-tests)
  const { rows: [run] } = await db.query<{ id: string }>(
    `insert into public.update_runs (agency_id, site_id, status, items, verdict, finished_at)
     values ($1, $2, 'done', '[{"type":"plugin","slug":"akismet/akismet.php","from_version":"5.0","to_version":"5.1"}]', 'deployed', now())
     returning id`,
    [ag.id, siteIds[0]],
  )
  await db.query(`insert into public.update_run_events (agency_id, run_id, step, message_key) values ($1, $2, 'done', 'run.done')`, [ag.id, run!.id])
  await db.query(
    `insert into public.test_results (agency_id, run_id, phase, page_key, page_url, viewport, passed) values ($1, $2, 'production_after', 'home', 'https://x.example/', 'desktop', true)`,
    [ag.id, run!.id],
  )
  await db.query(
    `insert into public.reports (agency_id, site_id, trigger, period_start, period_end, locale, status) values ($1, $2, 'manual', '2026-08-01', '2026-08-31', 'nl', 'ready')`,
    [ag.id, siteIds[0]],
  )
  await db.query(
    `insert into public.diagnoses (run_id, agency_id, source, locale, summary, cause, fix, confidence) values ($2, $1, 'rules', 'nl', 'x', 'x', 'x', 'low')`,
    [ag.id, run!.id],
  )
  await db.query(
    `insert into public.agency_invitations (agency_id, email, role, token_hash) values ($1, $2, 'member', $3)`,
    [ag.id, `invitee-${label}@example.test`, randomUUID()],
  )
  return { id: ag.id, owner, admin, member, siteIds }
}
