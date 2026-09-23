import type { Metadata } from 'next'
import './globals.css'
import { getLocale } from '@/lib/i18n/server'
import { I18nProvider } from '@/lib/i18n/client'

export const metadata: Metadata = {
  title: { default: 'Verploy', template: '%s · Verploy' },
  description: 'Verify before you deploy — veilige WordPress-updates voor webbureaus.',
  robots: { index: false, follow: false },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale}>
      <body className="min-h-dvh">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  )
}
