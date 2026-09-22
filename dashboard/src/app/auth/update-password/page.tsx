'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Logo } from '@/components/ui/Logo'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Wachtwoord moet minimaal 8 tekens bevatten.')
      return
    }

    if (password !== confirm) {
      setError('Wachtwoorden komen niet overeen.')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Logo />
        </div>

        <div className="card">
          <h1 className="text-lg font-bold text-text mb-1">Wachtwoord instellen</h1>
          <p className="text-sm text-subtle mb-6">Kies een wachtwoord voor je Verploy account.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="label">Nieuw wachtwoord</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Minimaal 8 tekens"
                  required
                  minLength={8}
                  className="input pr-10"
                  autoComplete="new-password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle hover:text-text transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirm" className="label">Bevestig wachtwoord</label>
              <input
                id="confirm"
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Herhaal wachtwoord"
                required
                className="input"
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div className="px-3 py-2.5 bg-danger/10 border border-danger/20 rounded-lg text-sm text-danger">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full justify-center"
            >
              {loading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Opslaan...
                </>
              ) : (
                'Wachtwoord instellen'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-subtle mt-6">
          Verploy - Verify before you deploy.
        </p>
      </div>
    </div>
  )
}
