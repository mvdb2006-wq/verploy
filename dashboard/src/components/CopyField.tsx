'use client'
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function CopyField({ value, label, copyLabel, copiedLabel, mono = true, large = false }: {
  value: string
  label: string
  copyLabel: string
  copiedLabel: string
  mono?: boolean
  large?: boolean
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex items-stretch gap-2">
        <output
          aria-label={label}
          className={`flex-1 overflow-x-auto rounded-lg border border-border2 bg-bg px-3.5 py-2.5 whitespace-nowrap text-text ${mono ? 'font-mono' : ''} ${large ? 'text-2xl tracking-[0.3em] font-bold' : 'text-sm'}`}
        >
          {value}
        </output>
        <button type="button" onClick={copy} className="btn btn-ghost shrink-0" aria-live="polite">
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
    </div>
  )
}
