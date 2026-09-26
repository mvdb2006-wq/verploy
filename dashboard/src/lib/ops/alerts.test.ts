import { describe, expect, it } from 'vitest'
import { alertMail, planAlerts, problemLabel, REMIND_HOURS, type AlertState } from './alerts'

const now = Date.parse('2026-09-26T12:00:00Z')
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString()
const st = (key: string, o: Partial<AlertState> = {}): AlertState => ({ key, detail: null, first_seen: ago(1), last_notified: ago(1), active: true, ...o })

describe('planAlerts', () => {
  it('nieuw probleem → melden; al gemeld → niet opnieuw tot de herinnering', () => {
    const p = [{ key: 'worker_down', detail: 'x' }]
    expect(planAlerts(p, [], now).fresh).toEqual(p)
    expect(planAlerts(p, [st('worker_down')], now)).toEqual({ fresh: [], reminders: [], resolved: [] })
    expect(planAlerts(p, [st('worker_down', { last_notified: ago(REMIND_HOURS) })], now).reminders).toEqual(p)
  })
  it('nog niet gemeld (mail lukte niet) of eerder opgelost → opnieuw als nieuw', () => {
    const p = [{ key: 'runs_stuck', detail: 'x' }]
    expect(planAlerts(p, [st('runs_stuck', { last_notified: null })], now).fresh).toEqual(p)
    expect(planAlerts(p, [st('runs_stuck', { active: false })], now).fresh).toEqual(p)
  })
  it('opgelost melden, maar niet voor fouten (momentopnamen) of nooit gemelde problemen', () => {
    const r = planAlerts([], [st('worker_down'), st('error:worker:claim_failed'), st('runs_stuck', { last_notified: null }), st('heartbeats_silent', { active: false })], now)
    expect(r.resolved.map(s => s.key)).toEqual(['worker_down'])
  })
})

describe('alertMail', () => {
  it('onderwerp noemt het eerste probleem; niets te melden → geen mail', () => {
    expect(alertMail({ fresh: [], reminders: [], resolved: [] }, 'https://app')).toBeNull()
    const m = alertMail({ fresh: [{ key: 'worker_down', detail: 'Laatste levensteken: 12:00' }, { key: 'error:stripe:webhook_failed', detail: '1×' }], reminders: [], resolved: [] }, 'https://app')!
    expect(m.subject).toBe('Verploy alarm: De worker draait niet (updates, rapporten en controles staan stil) (+1)')
    expect(m.text).toContain('Fout in de Stripe-webhook: webhook_failed — 1×')
    expect(alertMail({ fresh: [], reminders: [], resolved: [st('worker_down')] }, 'https://app')!.subject).toMatch(/^Verploy: opgelost/)
  })
  it('labels', () => {
    expect(problemLabel('error:worker:maintenance_failed')).toBe('Fout in de worker: maintenance_failed')
    expect(problemLabel('iets')).toBe('iets')
  })
})
