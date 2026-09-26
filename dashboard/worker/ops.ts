/**
 * Levensteken van de worker en fouten die de beheerder moet weten (tabel ops_events; zie
 * src/lib/ops/alerts.ts). Alleen fouten in de worker zelf, niet de gewone problemen van een site tijdens
 * een update (die ziet de klant in de run).
 */
import type { Admin } from './run'

const HEARTBEAT_EVERY_MS = 60_000
/** Logregels die een fout in de worker zelf betekenen. */
export const isOpsError = (msg: string) => /_(failed|crashed)$/.test(msg)

export function opsReporter(admin: () => Admin, workerId: string) {
  let lastBeat = 0
  return {
    beat() {
      if (Date.now() - lastBeat < HEARTBEAT_EVERY_MS) return
      lastBeat = Date.now()
      void admin().from('ops_heartbeats').upsert({ worker_id: workerId, seen_at: new Date().toISOString() }).then(() => undefined, () => undefined)
    },
    error(kind: string, detail: unknown) {
      const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
      void admin().from('ops_events').insert({ source: 'worker', kind: kind.slice(0, 80), detail: text.slice(0, 500) }).then(() => undefined, () => undefined)
    },
  }
}
