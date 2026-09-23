export type PeriodChoice = 'lastMonth' | 'thisMonth' | 'custom'

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Periode (YYYY-MM-DD, inclusief) voor een keuze in het formulier. Tijdzone: Europe/Amsterdam. */
export function periodFor(choice: PeriodChoice, from: string, to: string, now = new Date()): { start: string; end: string } | null {
  const today = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(now)}T00:00:00Z`)
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()
  if (choice === 'lastMonth') return { start: iso(new Date(Date.UTC(y, m - 1, 1))), end: iso(new Date(Date.UTC(y, m, 0))) }
  if (choice === 'thisMonth') return { start: iso(new Date(Date.UTC(y, m, 1))), end: iso(today) }
  if (choice !== 'custom' || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null
  if (to < from || to > iso(today) || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) return null
  return { start: from, end: to }
}
