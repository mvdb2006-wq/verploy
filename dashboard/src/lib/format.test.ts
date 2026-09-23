import { describe, expect, it } from 'vitest'
import { effectiveStatus, formatRelative } from './format'

describe('format', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  it('effectiveStatus', () => {
    expect(effectiveStatus({ status: 'pending', connection_status: 'awaiting_pairing', last_heartbeat_at: null }, now)).toBe('pending')
    expect(effectiveStatus({ status: 'online', connection_status: 'connected', last_heartbeat_at: '2026-09-24T11:50:00Z' }, now)).toBe('online')
    expect(effectiveStatus({ status: 'online', connection_status: 'connected', last_heartbeat_at: '2026-09-24T11:00:00Z' }, now)).toBe('offline')
  })
  it('formatRelative per taal', () => {
    expect(formatRelative('2026-09-24T11:57:00Z', 'nl', now)).toBe('3 minuten geleden')
    expect(formatRelative('2026-09-24T11:57:00Z', 'en', now)).toBe('3 minutes ago')
    expect(formatRelative(null, 'nl', now)).toBeNull()
  })
})
