import 'server-only'
import pkg from '../../package.json'

/** Versie van Verploy (package.json) en de build (commit op Vercel), zichtbaar in de zijbalk en instellingen. */
export function appVersion(): { version: string; build: string | null } {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? null
  return { version: pkg.version, build: sha ? sha.slice(0, 7) : null }
}
