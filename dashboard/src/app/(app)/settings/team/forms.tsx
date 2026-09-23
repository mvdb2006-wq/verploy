'use client'
import { useActionState } from 'react'
import { Alert } from '@/components/Alert'
import { CopyField } from '@/components/CopyField'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { useI18n } from '@/lib/i18n/client'
import type { MessageKey } from '@/lib/i18n/core'
import { changeRole, inviteMember, removeMember } from '../actions'

export function InviteForm({ allowAdmin }: { allowAdmin: boolean }) {
  const { t } = useI18n()
  const [state, action] = useActionState(inviteMember, {})
  return (
    <section className="card space-y-4" aria-labelledby="invite-title">
      <h2 id="invite-title" className="font-bold">{t('team.inviteTitle')}</h2>
      <form action={action} className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field id="invite-email" label={t('team.inviteEmail')}>
          <input id="invite-email" name="email" type="email" required className="input" />
        </Field>
        <Field id="invite-role" label={t('team.inviteRole')}>
          <select id="invite-role" name="role" className="input" defaultValue="member">
            <option value="member">{t('team.role.member')}</option>
            {allowAdmin && <option value="admin">{t('team.role.admin')}</option>}
          </select>
        </Field>
        <SubmitButton pendingLabel={t('common.saving')}>{t('team.inviteSubmit')}</SubmitButton>
      </form>
      {state.error && <Alert>{state.error}</Alert>}
      {state.link && (
        <div className="space-y-2">
          {state.emailed && <Alert tone="ok">{t('team.inviteEmailed', { email: state.email ?? '' })}</Alert>}
          <CopyField value={state.link} label={t('team.inviteLinkLabel', { email: state.email ?? '' })} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} />
          <p className="text-xs text-muted">{t('team.inviteLinkHelp')}</p>
        </div>
      )}
    </section>
  )
}

export function MemberActions({ userId, role, self, isOwner }: { userId: string; role: string; self: boolean; isOwner: boolean }) {
  const { t } = useI18n()
  const [roleState, roleAction] = useActionState(changeRole, {})
  const [removeState, removeAction] = useActionState(removeMember, {})
  const otherRoles = (['owner', 'admin', 'member'] as const).filter(r => r !== role)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {isOwner && otherRoles.map(r => (
        <form key={r} action={roleAction}>
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="role" value={r} />
          <button type="submit" className="btn btn-ghost px-3 py-1.5 text-xs">{t('team.makeRole', { role: t(`team.role.${r}` as MessageKey).toLowerCase() })}</button>
        </form>
      ))}
      <form action={removeAction}>
        <input type="hidden" name="user_id" value={userId} />
        <button type="submit" className="btn btn-danger px-3 py-1.5 text-xs">{self ? t('team.leave') : t('team.remove')}</button>
      </form>
      {(roleState.error || removeState.error) && <Alert className="basis-full">{roleState.error ?? removeState.error}</Alert>}
    </div>
  )
}
