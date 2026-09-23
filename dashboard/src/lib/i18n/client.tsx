'use client'
import { createContext, useContext, useMemo } from 'react'
import { createTranslator, type Locale, type Translate } from './core'

const Ctx = createContext<{ locale: Locale; t: Translate } | null>(null)

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: createTranslator(locale) }), [locale])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useI18n buiten I18nProvider')
  return v
}
