import { afterAll, describe, expect, it } from 'vitest'
import { actAs, asSuper, inTx, pool, seedAgency, type Db } from './helpers'

afterAll(() => pool.end())

const SLUG = 'intel-test/intel-test.php'
const item = (over: Record<string, unknown> = {}) => ({ type: 'plugin', slug: SLUG, name: 'Intel', from_version: '1.0', to_version: '2.0', ...over })

async function run(db: Db, agency: string, site: string, verdict: string, items: unknown[], daysAgo = 1) {
  await db.query(`insert into public.update_runs (agency_id, site_id, status, verdict, items, finished_at, created_at)
                  values ($1, $2, 'done', $3, $4, now() - make_interval(days => $5), now() - make_interval(days => $5))`,
  [agency, site, verdict, JSON.stringify(items), daysAgo])
}
async function refresh(db: Db) {
  await actAs(db, { role: 'service_role' })
  try { return (await db.query(`select public.refresh_update_intel() n`)).rows[0].n as number } finally { await asSuper(db) }
}
const intel = async (db: Db) =>
  (await db.query(`select version, ok_sites, failed_sites from public.update_intel where slug = $1 order by version`, [SLUG])).rows

describe('Verploy leert van alle sites (update_intel)', () => {
  it('telt per site één uitkomst: live gezet, of de versie zelf ging mis', () =>
    inTx(async db => {
      const a = await seedAgency(db, 'intel-a')
      const b = await seedAgency(db, 'intel-b')
      const [a1, a2] = a.siteIds, [b1, b2] = b.siteIds
      await run(db, a.id, a1!, 'deployed', [item({ staging: 'updated', production: 'updated' })])
      await run(db, a.id, a1!, 'deployed', [item({ staging: 'updated', production: 'updated' })])            // zelfde site telt één keer
      await run(db, a.id, a2!, 'blocked', [item({ staging: 'update_failed' })])                               // mislukt op de testkopie
      await run(db, b.id, b1!, 'rolled_back', [item({ staging: 'updated', production: 'updated' })])          // enige onderdeel, teruggedraaid
      await run(db, b.id, b2!, 'blocked', [item({ staging: 'updated' }), item({ slug: 'ander/x.php', staging: 'updated' })]) // samen met een ander: telt niet
      await run(db, b.id, b2!, 'blocked', [item({ to_version: '3.0', staging: 'no_package' })])               // pakketprobleem: telt niet als mislukt
      await run(db, b.id, b2!, 'deployed', [item({ to_version: '1.5', staging: 'updated', production: 'updated' })], 200) // te oud
      await asSuper(db)
      expect(await refresh(db)).toBeGreaterThanOrEqual(2)
      expect(await intel(db)).toEqual([
        { version: '2.0', ok_sites: 1, failed_sites: 2 },
        { version: '3.0', ok_sites: 0, failed_sites: 0 },
      ])
    }))

  it('een bureau ziet alleen cijfers van onderdelen die het zelf heeft; alleen de worker mag herberekenen', () =>
    inTx(async db => {
      const a = await seedAgency(db, 'intel-c')
      await db.query(`insert into public.update_intel (type, slug, version, ok_sites, failed_sites) values
                      ('plugin', 'akismet/akismet.php', '9.9', 5, 0), ('plugin', $1, '2.0', 3, 1)`, [SLUG])
      await actAs(db, { role: 'authenticated', ...a.owner })
      const seen = await db.query(`select slug from public.update_intel where version in ('9.9', '2.0')`)
      expect(seen.rows.map(r => r.slug)).toEqual(['akismet/akismet.php'])
      await expect(db.query(`select public.refresh_update_intel()`)).rejects.toThrow(/permission denied/)
    }))
})
