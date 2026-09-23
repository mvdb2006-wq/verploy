import { expect, it } from 'vitest'
import { safeNext } from './safe-next'

it.each([
  ['/sites/1', '/sites/1'], ['//evil.com', '/'], ['https://evil.com', '/'], ['/\\evil.com', '/'], [null, '/'], ['', '/'],
])('safeNext(%s) → %s', (input, out) => expect(safeNext(input)).toBe(out))
