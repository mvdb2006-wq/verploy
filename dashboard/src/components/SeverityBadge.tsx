import { AlertOctagon, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/cn'

export function SeverityBadge({ severity, label }: { severity: string; label: string }) {
  const Icon = severity === 'critical' ? AlertOctagon : severity === 'warning' ? AlertTriangle : Info
  return (
    <span className={cn('badge shrink-0', {
      'badge-danger': severity === 'critical',
      'badge-warn': severity === 'warning',
      'badge-muted': severity === 'info',
    })}>
      <Icon size={12} aria-hidden /> {label}
    </span>
  )
}
