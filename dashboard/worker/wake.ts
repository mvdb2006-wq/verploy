/**
 * WordPress voert geplande taken (ook de heartbeat van de connector) alleen uit als er iemand de site
 * bezoekt. Op een rustige site blijft de heartbeat dan uit en lijkt de site "offline", terwijl hij gewoon
 * werkt (Zeelte Transport: 71% uptime). Daarom tikt Verploy zulke sites zelf aan via wp-cron.php, zoals
 * WordPress dat zelf ook doet. Ligt de site echt plat, dan komt er ook dan geen heartbeat: dat blijft
 * gewoon als offline tellen.
 */
import type { Admin } from './run'

/** Na zoveel minuten zonder heartbeat tikt Verploy de site aan (de heartbeat loopt elke 15 minuten). */
export const WAKE_AFTER_MIN = 17

export interface WakeResult { sites: number; ok: number }

export async function wakeQuietSites(admin: Admin, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<WakeResult> {
  const before = new Date(now - WAKE_AFTER_MIN * 60_000).toISOString()
  const { data, error } = await admin.from('sites').select('id, url')
    .eq('connection_status', 'connected').lt('last_heartbeat_at', before).limit(100)
  if (error) throw error
  const out: WakeResult = { sites: 0, ok: 0 }
  await Promise.all((data ?? []).map(async s => {
    out.sites++
    const url = `${s.url.replace(/\/$/, '')}/wp-cron.php?doing_wp_cron=${(now / 1000).toFixed(4)}`
    try {
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { 'user-agent': 'Verploy-Worker/1.0 (+https://app.verploy.com; wp-cron)' },
        redirect: 'follow',
      })
      if (res.status < 500) out.ok++
      await res.arrayBuffer().catch(() => undefined)
    } catch { /* site niet bereikbaar: geen heartbeat, dat is dan terecht offline */ }
  }))
  return out
}
