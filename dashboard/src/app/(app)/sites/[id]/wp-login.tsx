'use client'
import { useActionState } from 'react'
import { Alert } from '@/components/Alert'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import { setWpLoginUser } from './actions'

export interface WpAdmin { id: number; login: string; name: string }
export interface WpLoginEntry { at: string; email: string; wpUser: string }

/** "Inloggen in WP Admin": als welke beheerder, en wie er de laatste tijd zo inlogde. */
export function WpLoginSettings({ siteId, admins, chosen, recent, enabledOnSite, canEdit }: {
  siteId: string; admins: WpAdmin[]; chosen: number | null; recent: WpLoginEntry[]; enabledOnSite: boolean; canEdit: boolean
}) {
  const { t } = useI18n()
  const [state, action] = useActionState(setWpLoginUser, {})
  return (
    <details className="group rounded-(--radius-card) border border-border bg-surface" id="wp-login">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 marker:hidden">
        <span className="font-bold">{t('wpLogin.title')}</span>
        <span className="text-xs text-muted">›</span>
      </summary>
      <div className="space-y-4 border-t border-border px-5 py-4">
        <p className="text-sm text-muted">{t('wpLogin.intro')}</p>
        {!enabledOnSite && <Alert tone="info">{t('wpLogin.disabledOnSite')}</Alert>}
        {state.error && <Alert>{state.error}</Alert>}
        {state.saved && <Alert tone="ok">{t('common.saved')}</Alert>}
        {canEdit && admins.length > 0 && (
          <form action={action} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="site_id" value={siteId} />
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">{t('wpLogin.asUser')}</span>
              <select name="wp_user_id" id="wp_user_id" className="input" defaultValue={chosen && admins.some(a => a.id === chosen) ? String(chosen) : ''}>
                <option value="">{t('wpLogin.firstAdmin', { login: admins[0]!.login })}</option>
                {admins.map(a => <option key={a.id} value={a.id}>{a.name && a.name !== a.login ? `${a.login} (${a.name})` : a.login}</option>)}
              </select>
            </label>
            <SubmitButton variant="ghost" pendingLabel={t('common.saving')}>{t('common.save')}</SubmitButton>
          </form>
        )}
        <div>
          <p className="text-sm font-semibold">{t('wpLogin.recent')}</p>
          {recent.length === 0 ? <p className="text-sm text-muted">{t('wpLogin.none')}</p> : (
            <ul className="mt-1 space-y-1 text-sm text-muted">
              {recent.map((r, i) => <li key={i}>{t('wpLogin.entry', { at: r.at, email: r.email, user: r.wpUser })}</li>)}
            </ul>
          )}
        </div>
      </div>
    </details>
  )
}
