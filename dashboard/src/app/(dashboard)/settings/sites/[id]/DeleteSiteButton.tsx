'use client'

import { useState, useTransition } from 'react'
import { Trash2 } from 'lucide-react'

export default function DeleteSiteButton({ siteId, siteName, onDelete }: {
  siteId: string
  siteName: string
  onDelete: (id: string) => Promise<{ error?: string }>
}) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    startTransition(async () => {
      const result = await onDelete(siteId)
      if (result?.error) {
        setError(result.error)
        setConfirming(false)
      }
      // On success, the server action redirects — no client handling needed
    })
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-2 w-full">
        <p className="text-sm text-danger text-center">
          Weet je zeker dat je <strong>{siteName}</strong> wilt verwijderen?
        </p>
        {error && <p className="text-xs text-danger text-center">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => setConfirming(false)}
            disabled={isPending}
            className="btn btn-ghost flex-1 justify-center"
          >
            Annuleren
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="btn flex-1 justify-center bg-danger text-white hover:bg-danger/90"
          >
            {isPending ? 'Verwijderen…' : 'Ja, verwijder'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="btn btn-ghost flex-1 justify-center text-danger hover:bg-danger/10"
    >
      <Trash2 size={14} />
      Site verwijderen
    </button>
  )
}
