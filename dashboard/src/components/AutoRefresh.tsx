'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Ververst de pagina periodiek zolang een run loopt. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000)
    return () => clearInterval(id)
  }, [router, seconds])
  return null
}
