import fs from 'node:fs'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { pool } from './helpers'
// @ts-expect-error — .mjs-script zonder typedeclaraties
import { generate } from '../../scripts/gen-db-types.mjs'

afterAll(() => pool.end())

it('src/lib/database.types.ts komt overeen met de migraties', async () => {
  const client = await pool.connect()
  try {
    const expected: string = await generate(client)
    const actual = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/lib/database.types.ts'), 'utf8')
    expect(actual, 'draai: node scripts/gen-db-types.mjs').toBe(expected)
  } finally {
    client.release()
  }
})
