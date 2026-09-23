'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X } from 'lucide-react'

type UpdateAction = (formData: FormData) => Promise<{ error?: string }>

export default function EditSiteForm({
  siteId,
  initialName,
  initialUrl,
  initialClientName,
  updateAction,
}: {
  siteId: string
  initialName: string
  initialUrl: string
  initialClientName: string | null
  updateAction: UpdateAction
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(initialName)
  const [url, setUrl] = useState(initialUrl)
  const [clientName, setClientName] = useState(initialClientName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleCancel() {
    setName(initialName)
    setUrl(initialUrl)
    setClientName(initialClientName ?? '')
    setError(null)
    setEditing(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const fd = new FormData()
    fd.set('id', siteId)
    fd.set('name', name)
    fd.set('url', url)
    fd.set('client_name', clientName)

    startTransition(async () => {
      const result = await updateAction(fd)
      if (result?.error) {
        setError(result.error)
      } else {
        setEditing(false)
        router.refresh()
      }
    })
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-muted hover:text-accent transition-colors"
        title="Naam bewerken"
      >
        <Pencil size={14} />
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="w-full mt-4 space-y-3">
      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="label block mb-1">Naam</label>
          <input
            className="input w-full"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            disabled={isPending}
          />
        </div>
        <div>
          <label className="label block mb-1">URL</label>
          <input
            className="input w-full font-mono text-xs"
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            required
            disabled={isPending}
          />
        </div>
        <div>
          <label className="label block mb-1">Klantnaam (optioneel)</label>
          <input
            className="input w-full"
            value={clientName}
            onChange={e => setClientName(e.target.value)}
            disabled={isPending}
          />
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCancel}
          disabled={isPending}
          className="btn btn-ghost flex-1 justify-center"
        >
          <X size={13} /> Annuleren
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="btn btn-primary flex-1 justify-center"
        >
          <Check size={13} /> {isPending ? 'Opslaan…' : 'Opslaan'}
        </button>
      </div>
    </form>
  )
}
