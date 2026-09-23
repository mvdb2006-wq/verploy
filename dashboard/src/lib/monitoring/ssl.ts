import tls from 'node:tls'

export type SslError = 'expired' | 'self_signed' | 'hostname_mismatch' | 'untrusted' | 'unreachable'

export interface SslResult {
  valid: boolean | null      // null: niet te beoordelen (onbereikbaar)
  expiresAt: string | null
  issuer: string | null
  error: SslError | null
}

/** Zet Node-TLS-foutcodes om naar de vaste set die de database accepteert. */
export function classifyTlsError(code: string | undefined | null): SslError {
  switch (code) {
    case 'CERT_HAS_EXPIRED':
      return 'expired'
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return 'self_signed'
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'hostname_mismatch'
    default:
      return 'untrusted'
  }
}

/**
 * Maakt een TLS-verbinding met de site (zoals een browser dat doet) en leest het
 * certificaat: verloopdatum, uitgever en of het vertrouwd is voor deze hostnaam.
 */
export function checkSsl(siteUrl: string, opts: { timeoutMs?: number; ca?: string | Buffer } = {}): Promise<SslResult> {
  const u = new URL(siteUrl)
  const host = u.hostname
  const port = Number(u.port || 443)
  return new Promise(resolve => {
    let done = false
    const finish = (r: SslResult) => { if (!done) { done = true; socket.destroy(); resolve(r) } }
    const socket = tls.connect({
      host, port,
      servername: /^[\d.]+$/.test(host) ? undefined : host,
      rejectUnauthorized: false,     // we willen het certificaat ook zien als het ongeldig is
      ca: opts.ca,
      timeout: opts.timeoutMs ?? 10_000,
    }, () => {
      const cert = socket.getPeerCertificate()
      if (!cert || !cert.valid_to) return finish({ valid: false, expiresAt: null, issuer: null, error: 'untrusted' })
      const expiresAt = new Date(cert.valid_to).toISOString()
      const issuer = (cert.issuer?.O ?? cert.issuer?.CN ?? null) as string | null
      let error: SslError | null = null
      if (new Date(cert.valid_to).getTime() < Date.now()) error = 'expired'
      else if (!socket.authorized) error = classifyTlsError((socket.authorizationError as unknown as { code?: string })?.code ?? String(socket.authorizationError ?? ''))
      else if (tls.checkServerIdentity(host, cert)) error = 'hostname_mismatch'
      finish({ valid: error === null, expiresAt, issuer: issuer ? String(issuer).slice(0, 200) : null, error })
    })
    socket.on('timeout', () => finish({ valid: null, expiresAt: null, issuer: null, error: 'unreachable' }))
    socket.on('error', () => finish({ valid: null, expiresAt: null, issuer: null, error: 'unreachable' }))
  })
}
