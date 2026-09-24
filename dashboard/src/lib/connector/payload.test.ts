import { describe, expect, it } from 'vitest'
import { heartbeatSchema, isNewerVersion, normalizePairingCode, parseMemoryLimitMb, toRows, type HeartbeatPayload } from './payload'

export const samplePayload: HeartbeatPayload = {
  schema: 2,
  collected_at: '2026-09-24T10:00:00+00:00',
  connector_version: '2.0.0',
  site: { url: 'https://klant.nl', name: 'Klant', locale: 'nl_NL', timezone: 'Europe/Amsterdam', multisite: false },
  server: { php_version: '8.3.12', memory_limit: '256M', memory_peak_bytes: 52_428_800, max_execution_time: 30,
    disk_free_bytes: 10_737_418_240, mysql_version: '10.11.8-MariaDB', db_size_bytes: 15_728_640 },
  wordpress: { version: '7.1.2', update_available: false, update_version: null },
  plugins: [{ file: 'akismet/akismet.php', name: 'Akismet', version: '5.3', active: true, update_available: true, update_version: '5.4' }],
  themes: [{ slug: 'twentytwentyfive', name: 'Twenty Twenty-Five', version: '1.2', active: true, update_available: false, update_version: null }],
}

describe('heartbeat-payload', () => {
  it('geldig voorbeeld wordt geaccepteerd', () => {
    expect(heartbeatSchema.safeParse(samplePayload).success).toBe(true)
  })

  it('oud schema (plugin 1.x) wordt geweigerd', () => {
    expect(heartbeatSchema.safeParse({ ...samplePayload, schema: 1 }).success).toBe(false)
  })

  it('rare versiestrings (injectie) worden geweigerd', () => {
    const bad = { ...samplePayload, wordpress: { ...samplePayload.wordpress, version: '7.1<script>' } }
    expect(heartbeatSchema.safeParse(bad).success).toBe(false)
  })

  it('zet om naar database-rijen met core als component', () => {
    const r = toRows(samplePayload)
    expect(r.snapshot).toMatchObject({ memory_limit_mb: 256, memory_peak_mb: 50, disk_free_mb: 10240, db_size_mb: 15, php_version: '8.3.12' })
    expect(r.components.map(c => `${c.type}:${c.slug}`)).toEqual(['core:wordpress', 'plugin:akismet/akismet.php', 'theme:twentytwentyfive'])
    expect(r.components[1]).toMatchObject({ update_available: true, latest_version: '5.4' })
  })

  it('verouderde updatemelding (lagere of gelijke versie) wordt genegeerd — geen downgrade aanbieden', () => {
    const r = toRows({ ...samplePayload, plugins: [
      { file: 'verploy-connector/verploy-connector.php', name: 'Verploy Connector', version: '2.2.0', active: true, update_available: true, update_version: '1.3.1' },
      { file: 'x/x.php', name: 'X', version: '1.0', active: true, update_available: true, update_version: '1.0' },
      { file: 'y/y.php', name: 'Y', version: '1.0-beta', active: true, update_available: true, update_version: '1.0' },
    ] })
    expect(r.components.slice(1, 4).map(c => [c.update_available, c.latest_version])).toEqual([[false, null], [false, null], [true, '1.0']])
  })

  it.each([['1.3.1', '2.2.0', false], ['2.2.1', '2.2.0', true], ['2.10', '2.9', true], ['6.8', '6.8.1', false], ['6.8.1', '6.8', true], ['5.4', null, true]] as const)(
    'isNewerVersion(%s, %s) → %s', (a, b, o) => { expect(isNewerVersion(a, b)).toBe(o) })

  it.each([['256M', 256], ['1G', 1024], ['512k', 1], ['-1', null], ['134217728', 128], ['onzin', null]])('memory_limit %s → %s', (i, o) => {
    expect(parseMemoryLimitMb(i)).toBe(o)
  })

  it('koppelcode wordt genormaliseerd', () => {
    expect(normalizePairingCode(' abcd-ef23 ')).toBe('ABCDEF23')
  })
})
