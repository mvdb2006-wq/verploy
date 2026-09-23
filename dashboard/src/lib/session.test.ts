import { describe, expect, it } from 'vitest'
import { agencyIsWritable, trialDaysLeft } from './session'
import type { Tables } from './database.types'

const base = { plan_status: 'trialing', trial_ends_at: '2026-10-01T12:00:00Z' } as Tables<'agencies'>
const now = new Date('2026-09-24T12:00:00Z')

describe('abonnementsstatus (spiegelt app.agency_is_writable)', () => {
  it('proef: schrijfbaar tot de einddatum', () => {
    expect(agencyIsWritable(base, now)).toBe(true)
    expect(agencyIsWritable(base, new Date('2026-10-02T00:00:00Z'))).toBe(false)
  })
  it('active, comped en past_due (Stripe incasseert nog) zijn schrijfbaar; canceled niet', () => {
    for (const s of ['active', 'comped', 'past_due']) expect(agencyIsWritable({ ...base, plan_status: s }, now)).toBe(true)
    for (const s of ['canceled']) expect(agencyIsWritable({ ...base, plan_status: s }, now)).toBe(false)
  })
  it('resterende proefdagen', () => {
    expect(trialDaysLeft(base, now)).toBe(7)
    expect(trialDaysLeft({ ...base, plan_status: 'active' }, now)).toBeNull()
    expect(trialDaysLeft(base, new Date('2026-12-01T00:00:00Z'))).toBe(0)
  })
})
