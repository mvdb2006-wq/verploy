import { Logo } from '@/components/Logo'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px]">
        <Logo className="mb-10" size={30} />
        {children}
      </div>
      <p className="mt-16 font-mono text-[11px] tracking-wider text-subtle">verify before you deploy</p>
    </main>
  )
}
