import { cn } from '@/lib/cn'

/** Vinkje + deploy-pijl in afgerond groen vierkant. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true" className={className}>
      <rect width="28" height="28" rx="7" fill="#22D98A" />
      <path d="M6.5 14.5 11.5 20 21.5 8.5" stroke="#080C16" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 8.5h4v4" stroke="#080C16" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <span className="text-[18px] leading-none font-extrabold tracking-[-0.03em]" aria-label="Verploy">
        <span className="text-text">ver</span>
        <span className="text-accent">ploy</span>
      </span>
    </span>
  )
}
