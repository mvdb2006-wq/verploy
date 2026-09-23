import { cn } from '@/lib/cn'

export function Alert({ tone = 'danger', children, className }: {
  tone?: 'danger' | 'ok' | 'warn' | 'info'
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-lg border px-3.5 py-2.5 text-sm', {
        'border-danger/30 bg-danger/10 text-danger': tone === 'danger',
        'border-accent/30 bg-accent/10 text-accent': tone === 'ok',
        'border-warn/30 bg-warn/10 text-warn': tone === 'warn',
        'border-border2 bg-surface2 text-muted': tone === 'info',
      }, className)}
    >
      {children}
    </div>
  )
}
