'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface Props {
  siteId: string
  slug: string
  name: string
  currentVersion: string
  toVersion: string
  createJobAction: (formData: FormData) => Promise<{ error?: string }>
}

export default function TriggerUpdateButton({
  siteId, slug, name, currentVersion, toVersion, createJobAction,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    const fd = new FormData()
    fd.append('site_id', siteId)
    fd.append('slug', slug)
    fd.append('name', name)
    fd.append('from_version', currentVersion)
    fd.append('to_version', toVersion)
    const result = await createJobAction(fd)
    setLoading(false)
    if (result.error) {
      setError(result.error)
    } else {
      setDone(true)
    }
  }

  if (done) {
    return <span className="text-xs text-accent font-semibold">In wachtrij ✓</span>
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleClick}
        disabled={loading}
        className="btn btn-primary py-0.5 px-2 text-xs h-auto leading-tight"
        title={`Update naar ${toVersion}`}
      >
        {loading
          ? <RefreshCw size={10} className="animate-spin" />
          : `→ ${toVersion}`}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  )
}
