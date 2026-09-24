import { redirect } from 'next/navigation'

/** Oude adres van Meldingen: alles staat nu in de Inbox. */
export default async function AlertsRedirect({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams
  redirect(view === 'resolved' ? '/inbox?view=resolved' : '/inbox')
}
