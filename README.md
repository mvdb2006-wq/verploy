# Verploy

**Verify before you deploy** — veilige WordPress-updates voor webbureaus.

| Map | Inhoud |
|---|---|
| `dashboard/` | Next.js 16-app (app.verploy.com): UI, plugin-API, crons |
| `connector-plugin/` | WordPress-plugin Verploy Connector (+ `build.sh`, `tests/`) |
| `supabase/migrations/` | Databaseschema (enige bron van waarheid) |
| `supabase/local/` | Lokale Supabase-compatibele stack voor ontwikkeling en tests |
| `worker/` | Update-worker (wordt herschreven in fase 4) |
| `ops/github-workflows/` | CI- en migratie-workflows (naar `.github/workflows/` zodra de token dat toestaat) |

Architectuur, fasering en status: `PLAN.md` · keuzes: `DECISIONS.md` · wat op Martijn wacht: `BLOCKERS.md`.

## Lokaal ontwikkelen en testen

Benodigd: Node 22, Postgres 16-binaries, PHP ≥ 7.4, de GoTrue- en PostgREST-release-binaries in één map (`LOCAL_SB_BIN`).

```bash
# 1. Lokale Supabase (Postgres :54322, API-gateway :54321)
LOCAL_SB_BIN=/pad/naar/binaries supabase/local/start.sh
#    Sleutels staan daarna in /tmp/verploy-local/keys.env → zet ze in dashboard/.env.local (zie .env.example)

# 2. Dashboard
cd dashboard && npm ci && npm run dev

# 3. Tests
npm run typecheck && npm run lint
npm run test:unit
LOCAL_SB_BIN=/pad/naar/binaries npm run test:db      # bouwt een schone testdatabase uit de migraties
node scripts/gen-db-types.mjs                         # na een schemawijziging

# 4. Plugin bouwen (alleen publiceren na groene tests)
WP_LOAD=/pad/naar/test-wp/wp-load.php PHPCS=/pad/naar/phpcs.phar connector-plugin/build.sh

# 5. End-to-end (dashboard via `next start` op :3000, test-WordPress op :8088 met
#    define('VERPLOY_API_BASE','http://127.0.0.1:3000/api/v2') in wp-config.php)
cd dashboard && npx playwright test
```

Deploy-instructies volgen in fase 8.
