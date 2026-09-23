import { cn } from '@/lib/cn'
import type { Tone } from '@/lib/runs'

export function RunBadge({ label, tone, className }: { label: string; tone: Tone; className?: string }) {
  return (
    <span className={cn('badge shrink-0', {
      'badge-ok': tone === 'ok',
      'badge-warn': tone === 'warn',
      'badge-danger': tone === 'danger',
      'badge-muted': tone === 'muted',
      'bg-accent/10 text-accent': tone === 'active',
    }, className)}>
      {tone === 'active' && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />}
      {label}
    </span>
  )
}
