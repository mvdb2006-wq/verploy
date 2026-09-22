'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { ArrowLeft, Globe, Plus, Loader2 } from 'lucide-react'
import Link from 'next/link'

type State = { error?: string } | null

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="btn btn-primary w-full">
      {pending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
      {pending ? 'Aanmaken…' : 'Site aanmaken'}
    </button>
  )
}

export default function NewSiteForm({
  addSite,
}: {
  addSite: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction] = useFormState(addSite, null)

  return (
    <div className="p-6 max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/settings" className="text-muted hover:text-text transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <p className="section-label mb-0.5">Instellingen</p>
          <h1 className="text-2xl font-extrabold text-text tracking-tight">Site toevoegen</h1>
        </div>
      </div>

      <div className="card mb-5">
        <div className="flex items-center gap-2 mb-5">
          <Globe size={15} className="text-accent" />
          <h2 className="font-bold text-text">Sitegegevens</h2>
        </div>

        {state?.error && (
          <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg px-4 py-3 mb-4">
            {state.error}
          </div>
        )}

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="name" className="label block mb-1.5">
              Sitenaam <span className="text-danger">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="bijv. Klant ABC — Webshop"
              className="input w-full"
              autoComplete="off"
            />
            <p className="text-xs text-subtle mt-1">Intern label om de site te herkennen.</p>
          </div>

          <div>
            <label htmlFor="url" className="label block mb-1.5">
              Website-URL <span className="text-danger">*</span>
            </label>
            <input
              id="url"
              name="url"
              type="url"
              required
              placeholder="https://www.example.com"
              className="input w-full font-mono text-sm"
              autoComplete="off"
            />
            <p className="text-xs text-subtle mt-1">De volledige URL inclusief https://</p>
          </div>

          <div>
            <label htmlFor="client_name" className="label block mb-1.5">
              Klantnaam <span className="text-muted">(optioneel)</span>
            </label>
            <input
              id="client_name"
              name="client_name"
              type="text"
              placeholder="bijv. Klant ABC"
              className="input w-full"
              autoComplete="off"
            />
          </div>

          <div className="pt-2">
            <SubmitButton />
          </div>
        </form>
      </div>

      {/* Uitleg */}
      <div className="card bg-surface2/50">
        <p className="text-sm font-semibold text-text mb-2">Hoe werkt het?</p>
        <ol className="text-sm text-muted space-y-2 list-none">
          <li className="flex gap-2.5">
            <span className="text-accent font-bold flex-shrink-0">1.</span>
            Vul de gegevens in en klik op &ldquo;Site aanmaken&rdquo;.
          </li>
          <li className="flex gap-2.5">
            <span className="text-accent font-bold flex-shrink-0">2.</span>
            Je krijgt een unieke API-sleutel voor deze site.
          </li>
          <li className="flex gap-2.5">
            <span className="text-accent font-bold flex-shrink-0">3.</span>
            Installeer de <strong className="text-text">Verploy Connector</strong> plugin op de WordPress-site.
          </li>
          <li className="flex gap-2.5">
            <span className="text-accent font-bold flex-shrink-0">4.</span>
            Vul de API-sleutel in de plugin-instellingen in. De site verschijnt automatisch online.
          </li>
        </ol>
      </div>
    </div>
  )
}
