import { createClient } from '@/lib/supabase/server'
import { getLocale, getT } from '@/lib/i18n/server'
import { canManage, requireAgency } from '@/lib/session'
import { formatDate } from '@/lib/format'
import type { MessageKey } from '@/lib/i18n/core'
import { revokeInvitation } from '../actions'
import { InviteForm, MemberActions } from './forms'

export async function generateMetadata() {
  return { title: (await getT())('team.title') }
}

export default async function TeamPage() {
  const session = await requireAgency()
  const [t, locale, supabase] = await Promise.all([getT(), getLocale(), createClient()])
  const { data: members } = await supabase.rpc('list_members')
  const { data: invites } = canManage(session.role)
    ? await supabase.from('agency_invitations').select('id, email, role, expires_at')
        .is('accepted_at', null).gt('expires_at', new Date().toISOString()).order('created_at')
    : { data: [] }
  const isOwner = session.role === 'owner'
  const ownerCount = (members ?? []).filter(m => m.role === 'owner').length

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('team.title')}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">{t('team.roleHelp')}</p>
      </div>

      <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="members-title">
        <h2 id="members-title" className="border-b border-border px-5 py-4 font-bold">{t('team.members')}</h2>
        <ul className="divide-y divide-border/60">
          {(members ?? []).map(m => {
            const self = m.user_id === session.user.id
            return (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.email} {self && <span className="text-subtle">{t('team.you')}</span>}</p>
                  <p className="text-xs text-muted">{t(`team.role.${m.role}` as MessageKey)}</p>
                </div>
                {(isOwner || self) && !(m.role === 'owner' && ownerCount === 1) && <MemberActions userId={m.user_id} role={m.role} self={self} isOwner={isOwner} />}
              </li>
            )
          })}
        </ul>
      </section>

      {canManage(session.role) && (
        <>
          <InviteForm allowAdmin={isOwner} />
          {(invites ?? []).length > 0 && (
            <section className="rounded-(--radius-card) border border-border bg-surface" aria-labelledby="pending-title">
              <h2 id="pending-title" className="border-b border-border px-5 py-4 font-bold">{t('team.pending')}</h2>
              <ul className="divide-y divide-border/60">
                {(invites ?? []).map(i => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <div>
                      <p className="text-sm font-medium">{i.email}</p>
                      <p className="text-xs text-muted">{t(`team.role.${i.role}` as MessageKey)} · {t('team.expires', { date: formatDate(i.expires_at, locale) })}</p>
                    </div>
                    <form action={revokeInvitation}>
                      <input type="hidden" name="id" value={i.id} />
                      <button type="submit" className="btn btn-ghost px-3 py-1.5 text-xs">{t('team.revoke')}</button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
