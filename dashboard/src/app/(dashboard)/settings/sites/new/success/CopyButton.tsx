'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export default function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: select text
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="flex-shrink-0 p-1.5 rounded-md hover:bg-border transition-colors"
      title="Kopieer API-sleutel"
    >
      {copied ? (
        <Check size={15} className="text-accent" />
      ) : (
        <Copy size={15} className="text-muted hover:text-text" />
      )}
    </button>
  )
}
