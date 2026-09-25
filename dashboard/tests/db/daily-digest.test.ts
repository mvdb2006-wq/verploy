import { afterAll, describe, expect, it } from 'vitest'
import { actAs, asSuper, expectError, inTx, pool, seedAgency, type Db } from './helpers'

afterAll(() => pool.end())

/** Etc/GMT-zone waarin het nu uur `h` is. */
function zoneAt(h: number): string {
  const offset = ((h - new Date().getUTCHours() + 36) % 24) - 12
  return offset === 0 ? 'Etc/GMT' : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`
}

async function setup(db: Db) {
  const a = await seedAgency(db, 'digest')
  await asSuper(db)
  await db.query(`update public.sites set connection_status = 'connected' where id = $1`, [a.siteIds[1]])
  return a
}
const claim = async (db: Db) => {
  await actAs(db, { role: 'service_role' })
  try { return (await db.query(`select * from public.claim_daily_digests(7, 500)`)).rows } finally { await asSuper(db) }
}

describe('ochtendmail', () => {
  it('standaard aan; alleen om 07:xx in de tijdzone van het bureau; één keer per dag; ontvangers eigenaar en beheerder', () =>
    inTx(async db => {
      const a = await setup(db)
      await db.query(`update public.agencies set timezone = $2 where id = $1`, [a.id, zoneAt(10)])
      expect((await claim(db)).map(r => r.agency_id)).not.toContain(a.id)
      await db.query(`update public.agencies set timezone = $2 where id = $1`, [a.id, zoneAt(7)])
      const rows = (await claim(db)).filter(r => r.agency_id === a.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].recipients.length).toBe(2)                       // eigenaar + beheerder, geen lid
      expect(Date.now() - new Date(rows[0].since).getTime()).toBeGreaterThan(23 * 3600_000)
      expect((await claim(db)).map(r => r.agency_id)).not.toContain(a.id)   // vandaag al verstuurd
    }))

  it('uitgezet of zonder gekoppelde site → geen mail', () =>
    inTx(async db => {
      const a = await setup(db)
      await db.query(`update public.agencies set timezone = $2, daily_digest = false where id = $1`, [a.id, zoneAt(7)])
      expect((await claim(db)).map(r => r.agency_id)).not.toContain(a.id)
      await db.query(`update public.agencies set daily_digest = true where id = $1`, [a.id])
      await db.query(`update public.sites set connection_status = 'awaiting_pairing' where agency_id = $1`, [a.id])
      expect((await claim(db)).map(r => r.agency_id)).not.toContain(a.id)
    }))

  it('aan/uit: eigenaar/beheerder mogen, lid niet; RPC alleen voor de worker', () =>
    inTx(async db => {
      const a = await setup(db)
      await actAs(db, { role: 'authenticated', ...a.member })
      expect((await db.query(`update public.agencies set daily_digest = false where id = $1`, [a.id])).rowCount).toBe(0)
      await actAs(db, { role: 'authenticated', ...a.owner })
      expect((await db.query(`update public.agencies set daily_digest = false where id = $1`, [a.id])).rowCount).toBe(1)
      expect((await expectError(db, `select * from public.claim_daily_digests(7, 1)`)).code).toBe('42501')
    }))
})
