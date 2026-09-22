import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow, format } from 'date-fns'
import { nl } from 'date-fns/locale'
import type { SiteStatus, AlertSeverity, UpdateRunStatus } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function timeAgo(date: string | null): string {
  if (!date) return 'Never'
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: nl })
}

export function formatDate(date: string | null): string {
  if (!date) return '—'
  return format(new Date(date), 'd MMM yyyy', { locale: nl })
}

export function statusColor(status: SiteStatus): string {
  return ({
    online:   'text-accent',
    offline:  'text-danger',
    degraded: 'text-warn',
    unknown:  'text-muted',
  } as Record<string, string>)[status] ?? 'text-muted'
}

export function statusDot(status: SiteStatus): string {
  return ({
    online:   'bg-accent',
    offline:  'bg-danger',
    degraded: 'bg-warn',
    unknown:  'bg-muted',
  } as Record<string, string>)[status] ?? 'bg-muted'
}

export function severityColor(severity: AlertSeverity): string {
  return {
    info:     'text-muted',
    warning:  'text-warn',
    critical: 'text-danger',
  }[severity]
}

export function runStatusLabel(status: UpdateRunStatus): string {
  return {
    queued:    'In wachtrij',
    staging:   'Staging...',
    testing:   'Testen...',
    applying:  'Toepassen...',
    completed: 'Voltooid',
    failed:    'Mislukt',
    blocked:   'Geblokkeerd',
  }[status]
}

export function sslSeverity(days: number | null): 'ok' | 'warn' | 'danger' {
  if (days === null) return 'ok'
  if (days <= 7)  return 'danger'
  if (days <= 30) return 'warn'
  return 'ok'
}

export function phpSeverity(major: string | null): 'ok' | 'warn' | 'danger' {
  if (!major) return 'ok'
  const version = parseFloat(major)
  if (version < 8.0) return 'danger'
  if (version < 8.2) return 'warn'
  return 'ok'
}

export function vitalsGrade(score: number | null): string {
  if (score === null) return '—'
  if (score >= 90) return 'A'
  if (score >= 70) return 'B'
  if (score >= 50) return 'C'
  return 'D'
}

export function vitalsColor(score: number | null): string {
  if (score === null) return 'text-muted'
  if (score >= 90) return 'text-accent'
  if (score >= 70) return 'text-warn'
  return 'text-danger'
}
