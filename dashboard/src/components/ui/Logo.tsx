import { cn } from '@/lib/utils'

interface LogoProps {
  size?: number
  className?: string
  showWordmark?: boolean
}

export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" className={className}>
      <rect width="28" height="28" rx="6" fill="#22D98A" fillOpacity="0.14" />
      <rect x="0.5" y="0.5" width="27" height="27" rx="5.5" stroke="#22D98A" strokeOpacity="0.35" />
      <path d="M6 15 L11.5 21 L23 8" stroke="#22D98A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.5 8 L23 8 L23 11.5" stroke="#22D98A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo({ showWordmark = true, className }: LogoProps) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={28} />
      {showWordmark && (
        <span className="text-[17px] font-extrabold tracking-[-0.5px] leading-none">
          <span className="text-text">ver</span>
          <span className="text-accent">ploy</span>
        </span>
      )}
    </div>
  )
}
