/**
 * Leest een groot JSON-object van de vorm { "sleutel": {…}, "sleutel": {…}, … } als stroom en geeft
 * elke waarde afzonderlijk terug. De Wordfence-feed is >100 MB; zo staat er steeds maar één record
 * tegelijk in het geheugen.
 */
export async function* streamObjectValues(chunks: AsyncIterable<string>): AsyncGenerator<unknown> {
  let depth = 0
  let inString = false
  let escaped = false
  let buf = ''          // tekst van de waarde die we nu lezen
  let capturing = false
  let started = false

  for await (const chunk of chunks) {
    let from = 0
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '{' || ch === '[') {
        depth++
        if (depth === 1) {
          if (ch !== '{' || started) throw new Error('feed_not_object')
          started = true
        } else if (depth === 2 && !capturing) {
          capturing = true
          from = i
          buf = ''
        }
      } else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 1 && capturing) {
          buf += chunk.slice(from, i + 1)
          capturing = false
          yield JSON.parse(buf)
          buf = ''
        } else if (depth < 0) {
          throw new Error('feed_malformed')
        }
      }
    }
    if (capturing) buf += chunk.slice(from)
  }
  if (depth !== 0 || !started) throw new Error('feed_truncated')
}

/** Web-ReadableStream van bytes → tekstblokken (UTF-8, ook als een teken over twee blokken valt). */
export async function* textChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      yield decoder.decode(value, { stream: true })
    }
    const rest = decoder.decode()
    if (rest) yield rest
  } finally {
    reader.releaseLock()
  }
}
