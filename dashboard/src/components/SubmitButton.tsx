'use client'
import { useFormStatus } from 'react-dom'
import { cn } from '@/lib/cn'

export function SubmitButton({ children, pendingLabel, className, variant = 'primary' }: {
  children: React.ReactNode
  pendingLabel?: string
  className?: string
  variant?: 'primary' | 'ghost' | 'danger'
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={cn('btn', `btn-${variant}`, className)}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  )
}
