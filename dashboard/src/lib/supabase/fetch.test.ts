import { describe, expect, it } from 'vitest'
import { resilientFetch } from './fetch'

/** Een fetch die de eerste `hangs` keer blijft hangen (tot het signaal afbreekt), daarna antwoordt. */
function flaky(hangs: number) {
  const calls: string[] = []
  const base = ((_: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init?.method ?? 'GET')
    if (calls.length <= hangs) {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
    }
    return Promise.resolve(new Response('ok'))
  }) as typeof fetch
  return { base, calls }
}

describe('resilientFetch', () => {
  it('lezen dat blijft hangen: afgebroken na de tijdslimiet en opnieuw geprobeerd', async () => {
    const { base, calls } = flaky(2)
    const res = await resilientFetch({ baseFetch: base, readTimeoutMs: 20 })('https://x/rest/v1/sites')
    expect(await res.text()).toBe('ok')
    expect(calls).toEqual(['GET', 'GET', 'GET'])
  })
  it('geeft op na de laatste poging (geen eindeloos wachten)', async () => {
    const { base, calls } = flaky(10)
    const t = Date.now()
    await expect(resilientFetch({ baseFetch: base, readTimeoutMs: 20, retries: 2 })('https://x')).rejects.toBeDefined()
    expect(calls).toHaveLength(3)
    expect(Date.now() - t).toBeLessThan(1_000)
  })
  it('schrijven wordt nooit herhaald', async () => {
    const { base, calls } = flaky(1)
    await expect(resilientFetch({ baseFetch: base, writeTimeoutMs: 20 })('https://x/rest/v1/rpc/f', { method: 'POST' })).rejects.toBeDefined()
    expect(calls).toEqual(['POST'])
  })
  it('afbreken door de aanroeper wordt gerespecteerd', async () => {
    const { base, calls } = flaky(10)
    const ctrl = new AbortController()
    const p = resilientFetch({ baseFetch: base, readTimeoutMs: 5_000 })('https://x', { signal: ctrl.signal })
    ctrl.abort()
    await expect(p).rejects.toBeDefined()
    expect(calls).toHaveLength(1)
  })
})
