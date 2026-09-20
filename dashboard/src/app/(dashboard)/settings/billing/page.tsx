'use client'

import { useState } from 'react'
import { PLAN_PRICES, PLAN_NAMES, type PlanId } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/client'

const PLANS: { id: PlanId; sites: string; highlight: boolean }[] = [
  { id: 'starter', sites: '10 sites',        highlight: false },
  { id: 'agency',  sites: '50 sites',        highlight: true  },
  { id: 'pro',     sites: 'Unlimited sites', highlight: false },
]

const FEATURES: Record<PlanId, string[]> = {
  starter: [
    'Full monitoring dashboard',
    'Automatic staging & testing',
    'Visual screenshot diff',
    'AI failure diagnosis',
    'White-label reports (NL/EN)',
    'Email alerts',
  ],
  agency: [
    'Everything in Starter',
    'Priority Playwright workers',
    'Custom test scripts per site',
    'Reports in 5 languages',
    'Slack + webhook alerts',
    'Priority support',
  ],
  pro: [
    'Everything in Agency',
    'Dedicated worker pool',
    'Custom domain for reports',
    'API access',
    'SLA & dedicated support',
    'White-glove onboarding',
  ],
}

export default function BillingPage() {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')
  const [loading, setLoading] = useState<PlanId | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)

  async function handleUpgrade(plan: PlanId) {
    setLoading(plan)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert('Something went wrong. Please try again.')
      }
    } catch {
      alert('Something went wrong. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  async function handlePortal() {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      alert('Something went wrong.')
    } finally {
      setPortalLoading(false)
    }
  }

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold mb-1">Billing & Plan</h1>
        <p className="text-muted-foreground text-sm">
          Manage your subscription and payment details.
        </p>
      </div>

      {/* Interval toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setInterval('monthly')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            interval === 'monthly'
              ? 'bg-accent text-[#080C16]'
              : 'bg-card border border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setInterval('yearly')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            interval === 'yearly'
              ? 'bg-accent text-[#080C16]'
              : 'bg-card border border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          Yearly
          <span className="ml-2 text-xs font-bold text-accent">−20%</span>
        </button>
      </div>

      {/* Plans grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.map(({ id, sites, highlight }) => {
          const price = PLAN_PRICES[id][interval]
          const name = PLAN_NAMES[id]
          const features = FEATURES[id]

          return (
            <div
              key={id}
              className={`card p-6 relative flex flex-col ${
                highlight ? 'border-accent' : ''
              }`}
            >
              {highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-[#080C16] text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                  Most popular
                </div>
              )}

              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
                {name}
              </div>

              <div className="text-4xl font-black tracking-tight mb-1">
                <span className="text-xl align-super">€</span>
                {price}
              </div>
              <div className="text-sm text-muted-foreground mb-2">
                per {interval === 'monthly' ? 'month' : 'year'}
              </div>
              <div className="text-sm font-semibold text-accent mb-5">{sites}</div>

              <ul className="space-y-2 mb-6 flex-1">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-accent font-bold flex-shrink-0 mt-0.5">✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleUpgrade(id)}
                disabled={loading !== null}
                className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all ${
                  highlight
                    ? 'btn btn-primary'
                    : 'btn bg-card border border-border hover:border-accent hover:text-accent'
                } disabled:opacity-50`}
              >
                {loading === id ? 'Redirecting…' : 'Start free trial'}
              </button>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        All plans include a 14-day free trial. No credit card required to start.
        Prices excl. VAT. Cancel anytime.
      </p>

      {/* Billing portal */}
      <div className="card p-6">
        <h2 className="font-bold mb-1">Manage subscription</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Update payment method, download invoices, or cancel your subscription.
        </p>
        <button
          onClick={handlePortal}
          disabled={portalLoading}
          className="btn btn-ghost"
        >
          {portalLoading ? 'Opening…' : 'Open billing portal →'}
        </button>
      </div>
    </div>
  )
}
