import { describe, expect, it } from 'vitest'
import { intelKey, intelMap, intelVerdict } from './intel'

describe('wat Verploy van alle sites weet', () => {
  it('te weinig sites: geen oordeel', () => {
    expect(intelVerdict(null)).toBeNull()
    expect(intelVerdict({ ok: 2, failed: 0 })).toBeNull()
  })
  it('bewezen, gemengd, riskant', () => {
    expect(intelVerdict({ ok: 212, failed: 0 })).toBe('proven')
    expect(intelVerdict({ ok: 40, failed: 1 })).toBe('mixed')         // één site: waarschijnlijk die site
    expect(intelVerdict({ ok: 30, failed: 4 })).toBe('mixed')         // < 25%
    expect(intelVerdict({ ok: 6, failed: 3 })).toBe('risky')
    expect(intelVerdict({ ok: 0, failed: 3 })).toBe('risky')
  })
  it('opzoeken per onderdeel en versie', () => {
    const m = intelMap([{ type: 'plugin', slug: 'a/a.php', version: '2.0', ok_sites: 5, failed_sites: 0 }])
    expect(m.get(intelKey('plugin', 'a/a.php', '2.0'))).toEqual({ ok: 5, failed: 0 })
  })
})
