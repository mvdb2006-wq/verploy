import { cn } from '@/lib/cn'

export function StatusBadge({ status, label }: { status: 'pending' | 'online' | 'offline'; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold', {
      'text-accent': status === 'online',
      'text-danger': status === 'offline',
      'text-muted': status === 'pending',
    })}>
      <span aria-hidden className={cn('size-2 rounded-full', {
        'bg-accent shadow-[0_0_0_3px_rgb(34_217_138/0.15)]': status === 'online',
        'bg-danger': status === 'offline',
        'border border-subtle': status === 'pending',
      })} />
      {label}
    </span>
  )
}
