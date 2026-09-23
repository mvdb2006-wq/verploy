/** Huidige release van Verploy Connector (direct-build), geserveerd door /api/v1/plugin/*. */
export const CONNECTOR_RELEASE = {
  version: '2.1.0',
  file: 'verploy-connector-2.1.0.zip',
  requiresWp: '5.8',
  testedWp: '7.1',
  requiresPhp: '7.4',
} as const

/** Heartbeat-interval dat de plugin aanhoudt (seconden). */
export const HEARTBEAT_INTERVAL_SECONDS = 900
