import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import pkg from '../../package.json'

describe('versienummer', () => {
  it('package.json en de bovenste versie in CHANGELOG.md zijn gelijk (ophogen bij elke uitrol)', () => {
    const log = fs.readFileSync(path.resolve(import.meta.dirname, '../../CHANGELOG.md'), 'utf8')
    const top = /^## (\d+\.\d+\.\d+)/m.exec(log)?.[1]
    expect(top).toBe(pkg.version)
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
