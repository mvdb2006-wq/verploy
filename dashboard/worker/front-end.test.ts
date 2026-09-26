import { describe, expect, it } from 'vitest'
import { affectsFrontEnd } from './run'

describe('affectsFrontEnd: telt de beeldvergelijking mee?', () => {
  const active = new Map([
    ['plugin:meta-box/meta-box.php', true], ['plugin:one-click-demo-import/one-click-demo-import.php', false],
    ['theme:twentytwentyfive', false], ['theme:hello-child', true], ['theme:hello-elementor', false],
  ])
  it('niet-actieve plugin of ongebruikt thema: nee', () => {
    expect(affectsFrontEnd([{ type: 'plugin', slug: 'one-click-demo-import/one-click-demo-import.php' }], active, ['hello-child', 'hello-elementor'])).toBe(false)
    expect(affectsFrontEnd([{ type: 'theme', slug: 'twentytwentyfive' }], active, ['hello-child', 'hello-elementor'])).toBe(false)
  })
  it('actieve plugin, parent-thema in gebruik, WordPress zelf, of onbekend: ja', () => {
    expect(affectsFrontEnd([{ type: 'plugin', slug: 'meta-box/meta-box.php' }], active, [])).toBe(true)
    expect(affectsFrontEnd([{ type: 'theme', slug: 'hello-elementor' }], active, ['hello-child', 'hello-elementor'])).toBe(true)
    expect(affectsFrontEnd([{ type: 'core', slug: 'wordpress' }], active, [])).toBe(true)
    expect(affectsFrontEnd([{ type: 'plugin', slug: 'nieuw/nieuw.php' }], active, [])).toBe(true)
    expect(affectsFrontEnd([{ type: 'theme', slug: 'twentytwentyfive' }], active, [])).toBe(true)      // geen gegevens over thema's: voorzichtig
    expect(affectsFrontEnd([{ type: 'theme', slug: 'twentytwentyfive' }], undefined, ['x'])).toBe(true)
  })
  it('gemengd: één onderdeel dat de voorkant raakt is genoeg', () => {
    expect(affectsFrontEnd([{ type: 'theme', slug: 'twentytwentyfive' }, { type: 'plugin', slug: 'meta-box/meta-box.php' }], active, ['hello-child'])).toBe(true)
  })
})
