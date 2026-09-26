import { describe, expect, it } from 'vitest'
import { signupMail } from './signups'

describe('signupMail', () => {
  it('onderwerp met e-mailadres; plan, tijd (Amsterdam) en status in de tekst', () => {
    const m = signupMail({ user_id: 'u', email: 'jan@bureau.nl', intended_plan: 'agency', created_at: '2026-09-26T15:30:00Z', attempts: 0, confirmed: false, agency_name: null, invited: false })
    expect(m.subject).toBe('New Verploy signup: jan@bureau.nl')
    expect(m.text).toContain('Intended plan: agency')
    expect(m.text).toContain('17:30')
    expect(m.text).toContain('Email confirmed: not yet')
    expect(m.text).toContain('Agency: not created yet')
  })
  it('zonder plan "none"; via uitnodiging; HTML is ge-escaped', () => {
    const m = signupMail({ user_id: 'u', email: 'a<b>@x.nl', intended_plan: null, created_at: '2026-09-26T15:30:00Z', attempts: 0, confirmed: true, agency_name: null, invited: true })
    expect(m.text).toContain('Intended plan: none')
    expect(m.text).toContain('joining via team invitation')
    expect(m.html).toContain('a&lt;b&gt;@x.nl')
  })
})
