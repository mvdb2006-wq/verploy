'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileText, Globe, Inbox, LayoutDashboard, LogOut, Settings, ShieldCheck } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { cn } from '@/lib/cn'
import { signOut } from '../(auth)/actions'

export function Sidebar({ agencyName, email, labels, inboxCount, version }: {
  agencyName: string
  email: string
  inboxCount: number
  version: string
  labels: { overview: string; inbox: string; sites: string; security: string; reports: string; settings: string; signOut: string; agency: string; mainNav: string; version: string }
}) {
  const path = usePathname()
  const nav = [
    { href: '/', label: labels.overview, icon: LayoutDashboard, active: path === '/', count: 0 },
    { href: '/inbox', label: labels.inbox, icon: Inbox, active: path.startsWith('/inbox'), count: inboxCount },
    { href: '/sites', label: labels.sites, icon: Globe, active: path.startsWith('/sites'), count: 0 },
    { href: '/security', label: labels.security, icon: ShieldCheck, active: path.startsWith('/security'), count: 0 },
    { href: '/reports', label: labels.reports, icon: FileText, active: path.startsWith('/reports'), count: 0 },
    { href: '/settings', label: labels.settings, icon: Settings, active: path.startsWith('/settings'), count: 0 },
  ]
  return (
    <aside className="flex shrink-0 flex-col border-b border-border bg-surface md:sticky md:top-0 md:h-dvh md:w-60 md:border-r md:border-b-0">
      <div className="flex items-center justify-between px-5 py-4 md:block md:py-6">
        <Link href="/" aria-label="Verploy"><Logo /></Link>
        <form action={signOut} className="md:hidden">
          <button className="btn btn-ghost px-3 py-1.5 text-xs" type="submit">{labels.signOut}</button>
        </form>
      </div>
      <div className="hidden px-5 pb-4 md:block">
        <p className="text-[10px] font-bold tracking-[0.14em] text-subtle uppercase">{labels.agency}</p>
        <p className="truncate text-sm font-semibold">{agencyName}</p>
      </div>
      <nav aria-label={labels.mainNav} className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:pb-0">
        {nav.map(({ href, label, icon: Icon, active, count }) => (
          <Link key={href} href={href} aria-current={active ? 'page' : undefined}
            className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              active ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2 hover:text-text')}>
            <Icon size={16} aria-hidden />
            {label}
            {count > 0 && <span className="ml-auto rounded-full bg-danger px-1.5 py-px text-[11px] font-bold text-white tabular-nums" aria-label={`${count}`}>{count}</span>}
          </Link>
        ))}
      </nav>
      <div className="hidden border-t border-border px-4 py-4 md:block">
        <p className="mb-2 truncate text-xs text-muted" title={email}>{email}</p>
        <form action={signOut}>
          <button type="submit" className="flex items-center gap-2 text-xs text-muted hover:text-danger">
            <LogOut size={13} aria-hidden /> {labels.signOut}
          </button>
        </form>
        <p className="mt-3 font-mono text-[11px] text-subtle" title={labels.version}>Verploy {version}</p>
      </div>
    </aside>
  )
}
