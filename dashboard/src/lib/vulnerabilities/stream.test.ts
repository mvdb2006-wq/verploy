import { describe, expect, it } from 'vitest'
import { streamObjectValues, textChunks } from './stream'

async function collect(chunks: string[]) {
  const out: unknown[] = []
  async function* gen() { for (const c of chunks) yield c }
  for await (const v of streamObjectValues(gen())) out.push(v)
  return out
}

const records = {
  'a-1': { id: 'a-1', title: 'Rare {tekens} en "quotes" \\ en ]', software: [{ slug: 'x', v: [1, 2, { y: '}' }] }] },
  'b-2': { id: 'b-2', title: 'Ünïcode — 漢字', software: [] },
  'c-3': { id: 'c-3', nested: { deep: { deeper: [[], {}] } } },
}
const text = JSON.stringify(records, null, 2)

describe('streamObjectValues', () => {
  it('geeft elk record terug, in volgorde', async () => {
    expect(await collect([text])).toEqual(Object.values(records))
  })

  it('werkt ongeacht waar de blokken splitsen', async () => {
    for (let cut = 1; cut < text.length; cut += 7) {
      expect(await collect([text.slice(0, cut), text.slice(cut)])).toEqual(Object.values(records))
    }
    expect(await collect(text.split(''))).toEqual(Object.values(records))
  })

  it('leeg object → niets', async () => {
    expect(await collect(['{}'])).toEqual([])
  })

  it('afgebroken of geen object → fout', async () => {
    await expect(collect([text.slice(0, text.length - 5)])).rejects.toThrow('feed_truncated')
    await expect(collect(['[1,2]'])).rejects.toThrow('feed_not_object')
    await expect(collect(['The requested version of this API has now been removed.'])).rejects.toThrow('feed_truncated')
  })
})

describe('textChunks', () => {
  it('UTF-8-tekens die over twee blokken vallen blijven heel', async () => {
    const bytes = new TextEncoder().encode(text)
    const stream = new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); c.close() },
    })
    const out: unknown[] = []
    for await (const v of streamObjectValues(textChunks(stream))) out.push(v)
    expect(out).toEqual(Object.values(records))
  })
})
