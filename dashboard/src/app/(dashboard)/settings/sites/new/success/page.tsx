import Link from 'next/link'
import { CheckCircle2, Copy, ArrowRight } from 'lucide-react'
import CopyButton from './CopyButton'

export const metadata = { title: 'Site toegevoegd' }

export default function SuccessPage({
  searchParams,
}: {
  searchParams: { id?: string; key?: string }
}) {
  const apiKey = searchParams.key ?? ''

  return (
    <div className="p-6 max-w-xl mx-auto">
      {/* Succes header */}
      <div className="flex flex-col items-center text-center mb-8 pt-4">
        <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center mb-4">
          <CheckCircle2 size={28} className="text-accent" />
        </div>
        <h1 className="text-2xl font-extrabold text-text tracking-tight mb-1">Site aangemaakt!</h1>
        <p className="text-sm text-muted">
          Kopieer de API-sleutel hieronder en voeg hem in de Verploy Connector plugin in.
        </p>
      </div>

      {/* API key */}
      <div className="card mb-5">
        <p className="label mb-3">Jouw API-sleutel</p>
        <div className="bg-surface2 rounded-lg px-4 py-3 flex items-center justify-between gap-3 mb-3">
          <code className="text-sm font-mono text-text break-all">{apiKey}</code>
          <CopyButton value={apiKey} />
        </div>
        <p className="text-xs text-subtle">
          Je kunt deze sleutel altijd terugvinden via{' '}
          <Link href="/settings" className="text-accent hover:underline">Instellingen → Sites & API-sleutels</Link>.
        </p>
      </div>

      {/* Stappen */}
      <div className="card mb-5">
        <p className="text-sm font-bold text-text mb-4">Volgende stappen</p>
        <ol className="space-y-4">
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
            <div>
              <p className="text-sm font-semibold text-text">Plugin installeren</p>
              <p className="text-xs text-muted mt-0.5">
                Ga naar WordPress → Plugins → Nieuwe toevoegen, zoek op <strong className="text-text">Verploy Connector</strong> en installeer de plugin.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
            <div>
              <p className="text-sm font-semibold text-text">API-sleutel invoeren</p>
              <p className="text-xs text-muted mt-0.5">
                Ga naar Instellingen → Verploy in WordPress en plak de API-sleutel hierboven.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
            <div>
              <p className="text-sm font-semibold text-text">Verbinding actief</p>
              <p className="text-xs text-muted mt-0.5">
                De site verschijnt binnen een paar minuten als <span className="text-accent font-semibold">Online</span> in je dashboard.
              </p>
            </div>
          </li>
        </ol>
      </div>

      {/* Acties */}
      <div className="flex gap-3">
        <Link href="/dashboard" className="btn btn-primary flex-1 justify-center">
          Naar dashboard
          <ArrowRight size={15} />
        </Link>
        <Link href="/settings/sites/new" className="btn btn-ghost flex-1 justify-center">
          Nog een site
        </Link>
      </div>
    </div>
  )
}
