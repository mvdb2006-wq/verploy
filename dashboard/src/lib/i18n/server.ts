import 'server-only'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { LOCALE_COOKIE, createTranslator, isLocale, negotiateLocale, type Locale, type Translate } from './core'
import { getSession } from '@/lib/session'

export { LOCALE_COOKIE }

/** Taal: die van het bureau (ingelogd), anders cookie, anders Accept-Language. */
export const getLocale = cache(async (): Promise<Locale> => {
  const session = await getSession()
  if (session?.agency && isLocale(session.agency.dashboard_locale)) return session.agency.dashboard_locale
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value
  if (isLocale(fromCookie)) return fromCookie
  return negotiateLocale((await headers()).get('accept-language'))
})

export async function getT(): Promise<Translate> {
  return createTranslator(await getLocale())
}
