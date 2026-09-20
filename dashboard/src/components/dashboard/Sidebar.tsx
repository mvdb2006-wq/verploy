'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Logo } from '@/components/ui/Logo'
import { cn } from '@/lib/utils'
import type { User } from '@supabase/supabase-js'
import {
  LayoutDashboard,
  Bell,
  FileText,
  Settings,
  LogOut,
  ChevronRight,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const NAV = [
  { href: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/alerts',     label: 'Meldingen',  icon: Bell },
  { href: '/reports',    label: 'Rapporten',  icon: FileText },
  { href: '/settings',   label: 'Instellingen', icon: Settings },
]

interface SidebarProps {
  user: User
  agency: { id: string; name: string; slug: string } | null
}

export function Sidebar({ user, agency }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col bg-surface border-r border-border h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-border">
        <Logo />
      </div>

      {/* Agency badge */}
      {agency && (
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-0.5">Agency</p>
          <p className="text-sm font-semibold text-text truncate">{agency.name}</p>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted hover:text-text hover:bg-surface2'
              )}
            >
              <Icon size={16} className="flex-shrink-0" />
              {label}
              {active && <ChevronRight size={14} className="ml-auto opacity-50" />}
            </Link>
          )
        })}
      </nav>

      {/* User + sign-out */}
      <div className="px-3 py-3 border-t border-border">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg mb-1">
          <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-accent">
              {user.email?.[0].toUpperCase() ?? '?'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-text truncate">{user.email}</p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 px-2 py-1.5 w-full rounded-lg text-xs text-muted hover:text-danger hover:bg-danger/10 transition-colors"
        >
          <LogOut size={13} />
          Uitloggen
        </button>
      </div>
    </aside>
  )
}
