'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'

/** Tabs binnen Instellingen: algemeen, team, abonnement, je eigen account. */
export function SettingsTabs({ labels }: { labels: { general: string; team: string; billing: string; account: string; nav: string } }) {
  const path = usePathname()
  const tabs = [
    { href: '/settings', label: labels.general, active: path === '/settings' },
    { href: '/settings/team', label: labels.team, active: path.startsWith('/settings/team') },
    { href: '/settings/billing', label: labels.billing, active: path.startsWith('/settings/billing') },
    { href: '/settings/account', label: labels.account, active: path.startsWith('/settings/account') },
  ]
  return (
    <nav aria-label={labels.nav} className="mx-auto mb-6 flex max-w-4xl gap-1 overflow-x-auto border-b border-border">
      {tabs.map(tab => (
        <Link key={tab.href} href={tab.href} aria-current={tab.active ? 'page' : undefined}
          className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap', tab.active ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text')}>
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
