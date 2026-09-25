import { getT } from '@/lib/i18n/server'
import { SettingsTabs } from './tabs'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = await getT()
  return (
    <>
      <SettingsTabs labels={{ general: t('settings.tabGeneral'), team: t('nav.team'), billing: t('billing.title'), account: t('mfa.tab'), nav: t('nav.settings') }} />
      {children}
    </>
  )
}
