import { describe, expect, it } from 'vitest'
import { wakeQuietSites, WAKE_AFTER_MIN } from './wake'
import type { Admin } from './run'

function fakeAdmin(rows: { id: string; url: string }[], seen: Record<string, unknown>) {
  const q = {
    select: () => q, eq: (k: string, v: unknown) => { seen[k] = v; return q },
    lt: (k: string, v: unknown) => { seen[k] = v; return q },
    limit: async () => ({ data: rows, error: null }),
  }
  return { from: () => q } as unknown as Admin
}

describe('wakeQuietSites', () => {
  it('tikt alleen gekoppelde sites zonder recente heartbeat aan via wp-cron.php', async () => {
    const seen: Record<string, unknown> = {}
    const urls: string[] = []
    const now = Date.parse('2026-09-26T12:00:00Z')
    const r = await wakeQuietSites(fakeAdmin([{ id: 'a', url: 'https://zeelte.example/' }, { id: 'b', url: 'https://plat.example' }], seen), (async (u: string) => {
      urls.push(u)
      if (u.includes('plat')) throw new Error('ECONNREFUSED')
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch, now)
    expect(seen.connection_status).toBe('connected')
    expect(seen.last_heartbeat_at).toBe(new Date(now - WAKE_AFTER_MIN * 60_000).toISOString())
    expect(urls).toEqual(['https://zeelte.example/wp-cron.php?doing_wp_cron=1790424000.0000', 'https://plat.example/wp-cron.php?doing_wp_cron=1790424000.0000'])
    expect(r).toEqual({ sites: 2, ok: 1 })
  })
})
