import { describe, expect, it } from 'vitest'
import { groupUpdates, type ComponentUpdate } from './group'

const c = (site: string, over: Partial<ComponentUpdate> = {}): ComponentUpdate =>
  ({ site_id: site, type: 'plugin', slug: 'woocommerce/woocommerce.php', name: 'WooCommerce', version: '11.1.2', latest_version: '11.2.0', ...over })
const names = new Map([['a', 'Borgo'], ['b', 'Feel Good'], ['c', 'Visgilde']])

describe('updates per onderdeel over alle sites', () => {
  it('één groep per onderdeel, sites op naam, hoogste doelversie', () => {
    const [g] = groupUpdates([c('c'), c('a', { latest_version: '11.2.1' }), c('b')], names)
    expect(g).toMatchObject({ name: 'WooCommerce', target: '11.2.1', major: false, security: false })
    expect(g!.sites.map(s => s.siteName)).toEqual(['Borgo', 'Feel Good', 'Visgilde'])
  })
  it('grote versiesprong en lek worden gemarkeerd; lekken bovenaan, dan meeste sites', () => {
    const gs = groupUpdates([
      c('a', { slug: 'wp-carousel/x.php', name: 'WP Carousel', version: '2.7.11', latest_version: '3.0.0' }),
      c('a'), c('b'),
      c('c', { slug: 'akismet/akismet.php', name: 'Akismet', version: '5.3', latest_version: '5.4' }),
    ], names, { vulnerable: new Set(['c:plugin:akismet/akismet.php']), busySites: new Set(['b']) })
    expect(gs.map(g => g.name)).toEqual(['Akismet', 'WooCommerce', 'WP Carousel'])
    expect(gs[0]!.security).toBe(true)
    expect(gs[2]!.major).toBe(true)
    expect(gs[1]!.sites.find(s => s.siteName === 'Feel Good')!.busy).toBe(true)
  })
  it('zonder aangeboden versie telt het niet mee', () => {
    expect(groupUpdates([c('a', { latest_version: null })], names)).toEqual([])
  })
})
