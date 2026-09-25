/**
 * Inlogtoken voor "Inloggen in WP Admin" (connector ≥ 2.5, zie class-sso.php):
 *   base64url(JSON) + "." + hex(HMAC-SHA256(site-secret, "sso|" + base64url(JSON)))
 * Hooguit 60 seconden geldig, eenmalig (nonce), voor één site op één adres en één bestaande beheerder.
 */
import { createHmac } from 'node:crypto'

export const LOGIN_TOKEN_TTL = 60
export const MIN_CONNECTOR_FOR_LOGIN = [2, 5, 0]

/** `aud`: het adres van de site; de connector weigert het token op een kloon of testkopie met een ander adres. */
export interface LoginClaims { site: string; aud: string; user: number; by: string; nonce: string; iat: number; exp: number }

export function buildLoginToken(c: LoginClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, site: c.site, aud: c.aud, user: c.user, by: c.by, nonce: c.nonce, iat: c.iat, exp: c.exp }), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(`sso|${payload}`).digest('hex')
  return `${payload}.${sig}`
}

export function loginClaims(o: { site: string; aud: string; user: number; by: string; nonce: string; now?: number }): LoginClaims {
  const iat = Math.floor((o.now ?? Date.now()) / 1000)
  return { site: o.site, aud: o.aud, user: o.user, by: o.by, nonce: o.nonce, iat, exp: iat + LOGIN_TOKEN_TTL }
}

/** De WordPress-inlogpagina die het token aanneemt. */
export function loginUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/wp-login.php?action=verploy_sso`
}

const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

/** Pagina die de browser meteen met een POST naar de site stuurt (token nooit in een URL of logbestand). */
export function autoPostPage(o: { action: string; token: string; title: string; button: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">
<title>${esc(o.title)}</title></head><body style="font-family:system-ui,sans-serif;background:#080C16;color:#F0F4FF;display:grid;place-items:center;min-height:100vh;margin:0">
<form id="f" method="post" action="${esc(o.action)}"><input type="hidden" name="token" value="${esc(o.token)}">
<p>${esc(o.title)}</p><noscript><button type="submit">${esc(o.button)}</button></noscript></form>
<script>document.getElementById('f').submit()</script></body></html>`
}
