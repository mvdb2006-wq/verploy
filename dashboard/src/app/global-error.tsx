'use client'

/** Laatste vangnet (als zelfs de root-layout faalt): geen vertalingen beschikbaar, dus kort en tweetalig. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#080C16', color: '#F0F4FF', fontFamily: 'system-ui, sans-serif', padding: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 22 }}>Something went wrong · Er ging iets mis</h1>
          <button type="button" onClick={reset} style={{ marginTop: 16, background: '#22D98A', color: '#080C16', border: 0, borderRadius: 8, padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}>
            Try again · Opnieuw proberen
          </button>
        </div>
      </body>
    </html>
  )
}
