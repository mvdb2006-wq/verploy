# Verploy — Supabase Database

## Schema overview

```
agencies          — one per Verploy customer (agency)
agency_members    — team access control (owner / admin / member)
sites             — WordPress sites connected via the plugin
health_snapshots  — every 15-min heartbeat from the WP plugin
site_plugins      — plugin inventory per snapshot
site_themes       — theme inventory per snapshot
update_runs       — one row per update attempt (with staging + test results)
test_results      — individual Playwright test results per run
alerts            — SSL expiry, offline, blocked updates, etc.
reports           — monthly client PDF report records
vulnerabilities   — WPScan cross-referenced CVEs
web_vitals        — LCP / CLS / FID / TTFB history
```

## Key view

`site_overview` — single-row-per-site summary for the agency dashboard.
Joins latest health snapshot + pending updates count + vitals score + alert count.

## Key function

`process_heartbeat(api_key, payload)` — called by the Next.js API route that
receives heartbeats from the WP plugin. Inserts a health snapshot, updates
site status, and auto-creates SSL alerts.

## Setup

```bash
# Install Supabase CLI
npm install -g supabase

# Start local Supabase
supabase start

# Apply schema
supabase db reset --db-url postgresql://postgres:postgres@localhost:54322/postgres
# Or manually:
psql -h localhost -p 54322 -U postgres -d postgres -f migrations/001_schema.sql

# Seed dev data
psql -h localhost -p 54322 -U postgres -d postgres -f seed/dev_seed.sql
```

## Environment variables (for Next.js)

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # server-side only, never expose to client
```
