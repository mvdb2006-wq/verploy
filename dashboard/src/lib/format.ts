import { DATE_LOCALE_TAG, type Locale } from '@/lib/i18n/core'

export function formatDate(iso: string | null | undefined, locale: Locale, withTime = false): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat(DATE_LOCALE_TAG[locale], withTime
    ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }
    : { dateStyle: 'medium', timeZone: 'Europe/Amsterdam' }).format(new Date(iso))
}

export function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(DATE_LOCALE_TAG[locale], { timeStyle: 'short', timeZone: 'Europe/Amsterdam' }).format(new Date(iso))
}

/** "3 minuten geleden" in de taal van het bureau. */
export function formatRelative(iso: string | null | undefined, locale: Locale, now = Date.now()): string | null {
  if (!iso) return null
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(DATE_LOCALE_TAG[locale], { numeric: 'auto' })
  const abs = Math.abs(diffSec)
  if (abs < 60) return rtf.format(diffSec, 'second')
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  return rtf.format(Math.round(diffSec / 86400), 'day')
}

/** Heartbeat elke 15 min; na 45 min stilte geldt een gekoppelde site als offline. */
export const OFFLINE_AFTER_MS = 45 * 60 * 1000

export function effectiveStatus(site: { status: string; connection_status: string; last_heartbeat_at: string | null }, now = Date.now()): 'pending' | 'online' | 'offline' {
  if (site.connection_status !== 'connected' || !site.last_heartbeat_at) return 'pending'
  return now - new Date(site.last_heartbeat_at).getTime() > OFFLINE_AFTER_MS ? 'offline' : 'online'
}
