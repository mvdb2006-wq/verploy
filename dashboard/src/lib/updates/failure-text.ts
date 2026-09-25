import type { MessageKey, Translate } from '@/lib/i18n/core'
import { failureKind } from './failure'

/**
 * Waar je bij bekende betaalde plugins de licentie activeert (menunamen zoals ze in WP Admin staan).
 * Sleutel: de map van de plugin (het deel van de slug vóór de "/").
 */
const LICENCE_PLACE: Record<string, string> = {
  js_composer: 'WPBakery → Product License',
  revslider: 'Slider Revolution → Dashboard → Register',
  masterslider: 'Master Slider → License',
  LayerSlider: 'LayerSlider → License',
  'elementor-pro': 'Elementor → License',
  gravityforms: 'Forms → Settings → License Key',
  'advanced-custom-fields-pro': 'ACF → Updates',
  'wp-rocket': 'Settings → WP Rocket → License',
  'monsterinsights-pro': 'Insights → Settings → License Key',
  'wordpress-seo-premium': 'Yoast SEO → Premium',
  bricks: 'Bricks → License',
  'ultimate-addons-for-gutenberg': 'Settings → UAG → License',
}

export const licencePlace = (slug: string | null | undefined): string | null => (slug ? LICENCE_PLACE[slug.split('/')[0]!] ?? null : null)

/**
 * De uitleg bij een mislukte update, met wat je eraan doet. Bij een licentieprobleem altijd beide
 * wegen: een eigen licentie activeren (met de plek in WP Admin als die bekend is), of — als de plugin
 * bij het thema hoort — bijwerken via een thema-update.
 */
export function failureAdvice(t: Translate, f: { kind: string; message: string | null }, slug?: string | null): string {
  const kind = failureKind(f)
  if (kind === 'license' || kind === 'no_package') {
    const place = licencePlace(slug)
    return [
      t(`runs.failure.${kind}` as MessageKey),
      place ? t('runs.failure.ownLicenceAt', { place }) : t('runs.failure.ownLicence'),
      t('runs.failure.themeBundled'),
    ].join(' ')
  }
  return t(`runs.failure.${kind}` as MessageKey)
}
