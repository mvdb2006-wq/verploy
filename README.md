# Verploy

**Verify before you deploy** — veilige WordPress-updates voor webbureaus.

| Map | Inhoud |
|---|---|
| `dashboard/` | Next.js 16-app (app.verploy.com): UI, plugin-API, crons |
| `connector-plugin/` | WordPress-plugin Verploy Connector (+ `build.sh`, `tests/`) |
| `supabase/migrations/` | Databaseschema (enige bron van waarheid) |
| `supabase/local/` | Lokale Supabase-compatibele stack voor ontwikkeling en tests |
| `dashboard/worker/` | Update-worker (Railway): staging, Playwright-tests, deploy, rollback, monitoringonderhoud |
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

# 4. Testlab voor de kernflow: WordPress op MySQL/MariaDB (staging vraagt MySQL) op :8089,
#    met FS_METHOD=direct en VERPLOY_API_BASE in wp-config.php; labplugins + update-repo:
connector-plugin/tests/lab/build-lab.sh /pad/naar/lab http://127.0.0.1:8090
php -S 127.0.0.1:8090 -t /pad/naar/lab/repo            # de "update-server" van de labplugins

# 5. Plugin bouwen (alleen publiceren na groene PHP-tests én engine-test)
WP_LOAD=/pad/naar/test-wp/wp-load.php PHPCS=/pad/naar/phpcs.phar \
ENGINE_WP_DIR=/pad/naar/mysql-wp ENGINE_SITE="<url> <site-id> <secret>" connector-plugin/build.sh

# 6. End-to-end (Playwright start zelf mock-e-mail, `next start` op :3000 en de worker)
cd dashboard && npx next build && npm run worker:build
E2E_LAB_WP_DIR=/pad/naar/mysql-wp E2E_LAB_DIR=/pad/naar/lab npx playwright test
```

## Worker

`npm run worker:build` bundelt `dashboard/worker/` naar `worker/dist/main.mjs`, en `npm run worker` start hem. Hij gebruikt dezelfde omgevingsvariabelen als het dashboard (zie `.env.example`). Voor productie is er `worker/Dockerfile` (Playwright-image) met `worker/railway.json`, zie BLOCKERS #3.
```

Deploy-instructies volgen in fase 8.
