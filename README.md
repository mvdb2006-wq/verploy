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

## Deployen (productie)

Verploy bestaat uit vier onderdelen die samen draaien. Zet ze in deze volgorde live; per stap staat hoe je controleert dat het werkt.

### 1. Database (Supabase)

1. Migraties toepassen: `supabase db push` (of de workflow `ops/github-workflows/supabase-migrations.yml` met de secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` en `SUPABASE_PROJECT_REF`). De migraties in `supabase/migrations/` zijn de enige bron van waarheid: ook de storage-buckets `run-artifacts`, `reports` en `branding` (alle drie privé) en de pg_cron-taak voor meldingen komen daaruit.
2. Auth → URL Configuration: Site URL `https://app.verploy.com`, en de redirect-URL `https://app.verploy.com/auth/callback`.
3. Controle: `select count(*) from public.plans` geeft 4, en `select app.agency_is_writable(id) from public.agencies` werkt.

### 2. Dashboard (Vercel)

- Root directory `dashboard`, framework Next.js. De productie-branch is `main`.
- Omgevingsvariabelen: zie `dashboard/.env.example`. Minimaal zijn nodig: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `VERPLOY_ENCRYPTION_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` en `STRIPE_PORTAL_CONFIGURATION`.
- `vercel.json` plant dagelijks `/api/cron/maintenance` als vangnet. Het echte onderhoud doet de worker elke 5 minuten.
- Controle: `https://app.verploy.com/api/health` geeft `{"ok":true}` (app en database bereikbaar).

### 3. Worker (Railway)

- Nieuw project vanuit de GitHub-repo, met root directory `dashboard` en config-bestand `worker/railway.json`. Die bouwt `worker/Dockerfile`, op basis van het officiële Playwright-image met Chromium voor tests en PDF's.
- Omgevingsvariabelen: dezelfde Supabase-, encryptie-, Resend- en `NEXT_PUBLIC_APP_URL`-waarden als in Vercel, plus optioneel `ANTHROPIC_API_KEY` (AI-diagnose) en `WORKER_ID`.
- Eén replica is genoeg. Wil je meer capaciteit, voeg dan replica's toe: runs en rapporten worden met `SKIP LOCKED` en leases verdeeld, zodat nooit twee workers dezelfde run doen.
- Controle: de healthcheck op `/` geeft `{"ok":true}`, en de logregel `"msg":"maintenance"` verschijnt elke 5 minuten.

### 4. Stripe

1. Zet `STRIPE_SECRET_KEY` in Vercel.
2. Draai `node --env-file=.env.local scripts/stripe-setup.mjs --webhook-url https://app.verploy.com/api/stripe/webhook` vanuit `dashboard/`, met de productiesleutels in `.env.local`. Dit maakt het product, de prijzen (uit de tabel `plans`), het klantportaal en de webhook aan en print `STRIPE_WEBHOOK_SECRET` en `STRIPE_PORTAL_CONFIGURATION`. Zet die in Vercel.
3. Prijzen wijzigen: pas de tabel `plans` aan (migratie) en draai het script opnieuw. De oude prijs wordt gearchiveerd; bestaande abonnementen blijven op hun prijs tot je ze omzet.

### 5. Verploy Connector (WordPress-plugin)

- Release: verhoog `VERPLOY_VERSION` en de header in `connector-plugin/verploy-connector/verploy-connector.php`, werk `readme.txt` bij en draai `connector-plugin/build.sh`. Dat draait de PHP 7.4-controle, de integratietests, de engine-test (staging/deploy/rollback op MySQL) en de WordPress.org Plugin Check. Alleen als alles slaagt, publiceert het script de zip naar `dashboard/public/downloads/`. Pas daarna `CONNECTOR_RELEASE` in `dashboard/src/lib/connector/release.ts` aan: sites met de direct-build zien de update dan in wp-admin.
- WordPress.org: dien `dist/verploy-connector-<versie>-wporg.zip` in; die versie bevat geen eigen updater.

### Na elke deploy

Doorloop één keer: registreren → site toevoegen → koppelen → veilige update (testplugin) → rapport maken. Zie de stappenlijst in `PLAN.md` §13.

