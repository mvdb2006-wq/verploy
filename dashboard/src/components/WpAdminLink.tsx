import type { ReactNode } from 'react'
import { versionAtLeast } from '@/lib/runs'
import { MIN_CONNECTOR_FOR_LOGIN } from '@/lib/wp-login/token'

/** Ondersteunt deze site "Inloggen in WP Admin" met één klik? (connector ≥ 2.5) */
export function wpLoginSupported(connectorVersion: string | null | undefined): boolean {
  return versionAtLeast(connectorVersion ?? null, MIN_CONNECTOR_FOR_LOGIN)
}

/**
 * Naar WP Admin: met één klik ingelogd (POST naar Verploy, dat een eenmalig token naar de site stuurt),
 * of — bij een oudere connector — gewoon de inlogpagina van WordPress.
 */
export function WpAdminLink({ siteId, siteUrl, sso, className, ariaLabel, children }: {
  siteId: string; siteUrl: string; sso: boolean; className?: string; ariaLabel?: string; children: ReactNode
}) {
  if (sso) {
    return (
      // rel="noopener" (niet "noreferrer"): anders stuurt de browser Origin: null en weigert Verploy het verzoek.
      <form method="post" action={`/sites/${siteId}/wp-admin`} target="_blank" rel="noopener" className="inline">
        <button type="submit" className={className} aria-label={ariaLabel}>{children}</button>
      </form>
    )
  }
  return (
    <a href={`${siteUrl.replace(/\/$/, '')}/wp-admin/`} target="_blank" rel="noopener noreferrer" className={className} aria-label={ariaLabel}>{children}</a>
  )
}
