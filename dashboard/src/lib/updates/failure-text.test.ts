import { describe, expect, it } from 'vitest'
import { LOCALES, createTranslator } from '@/lib/i18n/core'
import { failureAdvice, licencePlace } from './failure-text'

describe('failureAdvice', () => {
  const nl = createTranslator('nl')
  it('WPBakery zonder licentie: beide wegen, met de plek in WP Admin', () => {
    const a = failureAdvice(nl, { kind: 'bad_package', message: 'Download failed. De opgegeven URL is ongeldig.' }, 'js_composer/js_composer.php')
    expect(a).toContain('De maker van de plugin gaf geen downloadbestand.')
    expect(a).toContain('Activeer die dan in WP Admin onder WPBakery → Product License')
    expect(a).toContain('Zit de plugin bij je thema')
  })
  it('onbekende betaalde plugin: algemene plek; andere oorzaken zonder licentie-uitleg', () => {
    expect(failureAdvice(nl, { kind: 'license', message: null }, 'onbekend/x.php')).toContain('bij de instellingen van de plugin')
    expect(failureAdvice(nl, { kind: 'permissions', message: null }, 'js_composer/js_composer.php')).not.toContain('licentie')
    expect(licencePlace('revslider/revslider.php')).toBe('Slider Revolution → Dashboard → Register')
    expect(licencePlace(null)).toBeNull()
  })
  it('alle talen zonder ontbrekende teksten', () => {
    for (const l of LOCALES) {
      const a = failureAdvice(createTranslator(l), { kind: 'license', message: null }, 'js_composer/js_composer.php')
      expect(a, l).not.toMatch(/runs\.failure|\{place\}/)
      expect(a, l).toContain('WPBakery → Product License')
    }
  })
})
