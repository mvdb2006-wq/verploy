import { cn } from '@/lib/cn'

export function Field({ id, label, hint, error, children, className }: {
  id: string
  label: string
  hint?: string
  error?: string | null
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-0', className)}>
      <label htmlFor={id} className="label">{label}</label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-xs text-subtle">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="field-error">{error}</p>}
    </div>
  )
}
