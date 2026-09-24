/**
 * fetch voor de Supabase-clients op de server: nooit minutenlang blijven hangen.
 *
 * Op Vercel (Fluid) kan een hergebruikte keep-alive-verbinding na een pauze van de functie "dood" zijn;
 * zonder tijdslimiet wacht een verzoek dan minutenlang (in productie: een sitepagina van 4 minuten, en
 * alle verzoeken op dezelfde instantie wachtten mee). Daarom: elke poging heeft een tijdslimiet, en
 * alleen lezen (GET/HEAD — veilig om te herhalen) wordt bij een time-out of netwerkfout opnieuw geprobeerd
 * over een nieuwe verbinding. Schrijven wordt nooit automatisch herhaald.
 */
export interface ResilientFetchOptions {
  /** Tijdslimiet per poging voor lezen (ms). */
  readTimeoutMs?: number
  /** Tijdslimiet voor schrijven/RPC (ms); ruimer, want die worden niet herhaald. */
  writeTimeoutMs?: number
  /** Extra pogingen voor lezen. */
  retries?: number
  /** Voor tests. */
  baseFetch?: typeof fetch
}

const IDEMPOTENT = new Set(['GET', 'HEAD'])

export function resilientFetch(opts: ResilientFetchOptions = {}): typeof fetch {
  const { readTimeoutMs = 8_000, writeTimeoutMs = 30_000, retries = 2 } = opts
  return async (input, init) => {
    const base = opts.baseFetch ?? fetch
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const idempotent = IDEMPOTENT.has(method)
    const attempts = idempotent ? retries + 1 : 1
    const timeout = idempotent ? readTimeoutMs : writeTimeoutMs
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (init?.signal?.aborted) throw init.signal.reason
      const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
      try {
        return await base(input, { ...init, signal })
      } catch (err) {
        // Afgebroken door de aanroeper zelf: niet herhalen.
        if (init?.signal?.aborted) throw err
        lastError = err
      }
    }
    throw lastError
  }
}
