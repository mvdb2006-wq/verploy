import { describe, expect, it } from 'vitest'
import { normalizeSiteUrl, sameSite } from './url'

describe('normalizeSiteUrl', () => {
  it.each([
    ['https://Voorbeeld.NL/', 'https://voorbeeld.nl'],
    ['voorbeeld.nl', 'https://voorbeeld.nl'],
    ['http://voorbeeld.nl/blog/', 'http://voorbeeld.nl/blog'],
    ['https://voorbeeld.nl:8443/?x=1#y', 'https://voorbeeld.nl:8443'],
    ['  https://www.klant.be  ', 'https://www.klant.be'],
  ])('%s → %s', (input, out) => expect(normalizeSiteUrl(input)).toBe(out))

  it.each(['', 'ftp://x.nl', 'javascript:alert(1)', 'https://user:pw@x.nl', 'geen-punt', 'https://'])('weigert %s', input => {
    expect(normalizeSiteUrl(input)).toBeNull()
  })

  it('sameSite negeert http/https en www.', () => {
    expect(sameSite('https://www.klant.nl/', 'http://klant.nl')).toBe(true)
    expect(sameSite('https://klant.nl', 'https://andere.nl')).toBe(false)
    expect(sameSite('https://klant.nl/a', 'https://klant.nl/b')).toBe(false)
  })
})
