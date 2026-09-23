# Verploy — PLAN

> Verify before you deploy. Een WordPress-update gaat pas live als bewezen is dat niets breekt.

Dit bestand is het werkgeheugen van het project: architectuur, datamodel, jobflow en fasering met status.
Keuzes met onderbouwing staan in `DECISIONS.md`, en wat op Martijn wacht staat in `BLOCKERS.md`.

---

## Fasestatus

| # | Fase | Status | Klaar als |
|---|------|--------|-----------|
| 1 | Inventarisatie + architectuur | ✅ klaar (23-09-2026) | PLAN.md bevat datamodel, services, jobflow en fasering |
| 2 | Fundament: auth, bureaus, teamleden, site koppelen | ✅ klaar lokaal (24-09) · productie wacht op BLOCKERS #2 | Nieuw bureau registreert, koppelt site, plugin stuurt aantoonbaar data. RLS-tests groen |
| 3 | Monitoring + dashboard | ✅ klaar lokaal (24-09) · productie wacht op BLOCKERS #2 | Health-data opgeslagen, getoond, drempels → in-app + e-mail (Resend) |
| 4 | Veilige updates (kernflow 1–7) | ✅ klaar lokaal (24-09) · productie wacht op BLOCKERS #2, #3 | E2E op echte test-WordPress: geslaagd → live, gebroken → tegengehouden, gezakte post-check → teruggedraaid |
| ⛔ | **Controlemoment** | — | Stop, oplevering aan Martijn, wacht op "ga door" |
| 5 | AI-diagnose | ✅ klaar lokaal (24-09) · AI-verfijning wacht op BLOCKERS #6 (werkt nu regelgebaseerd) | Begrijpelijke uitleg met oorzaak + oplossing bij gezakte test |
| 6 | Rapporten | ✅ klaar lokaal (24-09) · versturen vanaf verploy.com wacht op BLOCKERS #5 | PDF in NL/DE/FR/ES/EN, bureau-branding, handmatig + maandelijks automatisch |
| 7 | Stripe | — | Abonneren/upgraden/downgraden/opzeggen in testmodus; tier-limiet server-side afgedwongen |
| 8 | Afwerking | — | Onboarding, lege staten, foutmeldingen, responsive, plugin volgens WP.org-richtlijnen, README met deploy |

---

## 1. Inventarisatie (23-09-2026)

### 1.1 Wat er staat

| Onderdeel | Locatie | Staat |
|---|---|---|
| Dashboard | `dashboard/` — Next.js 14.2.5, React 18, Tailwind 3, `@supabase/ssr` 0.4 | Draait live op app.verploy.com (Vercel, auto-deploy vanaf `main`) |
| Database | `supabase/schema.sql` + 5 losse migraties; live project `awsdapsdlazppvaemrki` | Live: 1 bureau, 1 gebruiker, 3 sites, ~60 snapshots, 0 update-jobs |
| Connector-plugin | `connector-plugin/verploy-connector/` v1.3.1 | Heartbeat elke 15 min, REST `/status` `/health` `/update`, job-runner, eigen updater |
| Oude plugin | `wp-plugin/verploy-connector/` (1 bestand, v1.0) | Verouderd duplicaat |
| Worker | `worker/` — Express + Playwright + OpenAI | **Nooit gedeployd** (geen Railway-project bekend) |
| Landingspagina | Claude-artifact | Buiten scope op verzoek van Martijn (focus = app.verploy.com) |

### 1.2 Wat aantoonbaar werkt

- Inloggen met Supabase e-mail/wachtwoord, en het automatisch aanmaken van een bureau bij de eerste login.
- Een site toevoegen en de API-key tonen. De plugin stuurt heartbeats, die worden opgeslagen (snapshots + plugins).
- Site-detailpagina met plugins en de update-knop (push naar `/wp-json/verploy/v1/update`), getest door Martijn op 23-09.
- Offline-detectie via Vercel-cron (dagelijks, want Hobby-plan).
- Connector 1.3.1: getest op echte WordPress 7.1.2 (frontend, wp-admin, instellingenpagina, job-runner).

### 1.3 Wat half of kapot is — en wat ermee gebeurt

| Probleem | Ernst | Besluit |
|---|---|---|
| `site_overview` is een view zonder `security_invoker`, met `GRANT SELECT TO authenticated`, en bevat `api_key`. Elke ingelogde gebruiker kan zo de sleutels van **alle** sites lezen, en registreren staat open. | **Kritiek (lek)** | ✅ Gedicht op 23-09 (security_invoker, anon ingetrokken, registratie uit, alle keys geroteerd, test bewezen). v2 heeft geen views met secrets meer |
| Plugin ↔ backend werkt met een platte bearer-key (dezelfde key in beide richtingen, zonder handtekening, timestamp of replay-bescherming) | Hoog | Wordt herschreven naar HMAC-SHA256 + timestamp + nonce (§4) |
| `is_agency_owner()` (migratie 20260923) verwijst naar `agencies.owner_id`, maar die kolom bestaat niet → policies voor eigenaren falen | Hoog | Herschreven op basis van `agency_members.role` |
| Policy "owners can update their agency" vergelijkt `agency_members.agency_id = agency_members.id` → is altijd onwaar | Middel | Herschreven |
| `update_jobs`-tabel staat niet in de repo (handmatig aangemaakt) en heeft RLS `ALL` voor elk lid | Middel | Opgaan in het nieuwe `update_runs`-model |
| Worker: gaat ervan uit dat `staging.<domein>` al bestaat, heeft geen rollback of post-check, stuurt `X-Verploy-Key` terwijl de plugin `Authorization` verwacht, gebruikt `update_runs` naast `update_jobs`, en zet screenshots in een publieke bucket | Hoog | Worker wordt volledig herschreven (§5) |
| Connector 1.3.0 gaf een fatale fout op elke pagina (skin-class te vroeg geladen). Hersteld in 1.3.1 | Opgelost | Releaseproces: elke plugin-build eerst op test-WordPress (§8) |
| Plugin bevat een eigen updater (`class-updater.php`). Dat mag niet op WordPress.org (richtlijn 8) | Middel | Twee builds: `wporg` zonder updater, `direct` met updater tot WP.org-goedkeuring |
| Dubbele of oude endpoints: `/api/heartbeat` (verwacht `vp_live_` keys), `/api/v1/ping`, `/api/v1/sites/ping`, `/api/updates/trigger` | Laag | Verwijderen; één set v2-endpoints |
| Repo-rommel: ~25 `.patch`-bestanden, `Claude outputs/`, losse `layout.tsx`, `*.zip`, `tsbuildinfo` | Laag | Opruimen in fase 2 |
| Stripe-prijzen €29/79/199 en tiers starter/agency/pro wijken af van de opdracht (€19–249) | Middel | Nieuwe tiers (§3.3), herbouw in fase 7 |
| Pakketten zijn 1–2 major-versies oud (Next 14, React 18, Tailwind 3, Stripe 17) | Middel | Upgrade in fase 2 naar de versies in DECISIONS.md |
| Er zijn geen tests | Hoog | Vitest + pg-tests + Playwright E2E vanaf fase 2 |

### 1.4 Wat blijft

De visuele stijl (Tailwind-tokens, `Logo`, `Sidebar`) en de UX van het dashboard, het Supabase-project en de bestaande data (het bureau, de gebruiker en de sites worden meegemigreerd), de health-collector in de plugin (degelijk, alleen de uitvoer wordt uitgebreid), het Vercel-project en het domein.

---

## 2. Architectuur

```
                ┌────────────────────────── Vercel (app.verploy.com) ───────────────────────────┐
 Browser ──────▶│ Next.js 16 App Router                                                         │
 (bureau)       │  • dashboard UI (server components, server actions)                            │
                │  • /api/v2/connect      pairing: plugin ruilt koppelcode in voor site-secret   │
                │  • /api/v2/heartbeat    HMAC-gesigneerd, health-data in                        │
                │  • /api/v2/runs/*       dashboard start/annuleert update-runs                  │
                │  • /api/stripe/webhook  abonnementen                                           │
                │  • /api/cron/*          drempelcontrole, maandrapporten, stale-job sweep        │
                └──────────────┬──────────────────────────────────────────┬─────────────────────┘
                               │ supabase-js (anon + RLS / service role)  │
                ┌──────────────▼───────────────┐              ┌───────────▼──────────┐
                │ Supabase                     │              │ Resend (e-mail)      │
                │  Postgres + RLS              │              └──────────────────────┘
                │  Auth (e-mail + wachtwoord)  │
                │  Storage (private buckets:   │
                │   screenshots, reports,      │
                │   branding)                  │
                └──────────────▲───────────────┘
                               │ service role, claim_job() met SKIP LOCKED
                ┌──────────────┴───────────────────────────────────────────────┐
                │ Worker op Railway (Node 22, Playwright 1.63, Puppeteer 25)     │
                │  • job-loop: update_run state machine (§5)                     │
                │  • Playwright: functionele tests + screenshots + pixel-diff    │
                │  • Puppeteer: PDF-rapporten                                    │
                │  • Anthropic API: AI-diagnose (fase 5)                         │
                └──────────────┬─────────────────────────────────────────────────┘
                               │ HMAC-gesigneerde REST-calls
                ┌──────────────▼─────────────────────────────────────────────────┐
                │ WordPress-site van de klant + Verploy Connector 2.x             │
                │  • heartbeat (WP-Cron, 15 min) → /api/v2/heartbeat              │
                │  • /wp-json/verploy/v2/…  staging, updates, snapshot, rollback  │
                │  • staging = kopie op dezelfde server (submap + tabelprefix)     │
                └─────────────────────────────────────────────────────────────────┘
```

### Services en verantwoordelijkheden

| Service | Doet | Doet niet |
|---|---|---|
| **Dashboard (Vercel)** | Auth, UI, pairing, heartbeat verwerken, runs aanmaken (met tier- en rolcontrole), drempel-alerts, Stripe-webhooks, crons | Geen langlopend werk (>10 s), geen browserautomatisering |
| **Worker (Railway)** | Alle stappen van een update-run, PDF-generatie, AI-diagnose | Geen gebruikersinput; leest alleen jobs uit de database |
| **Connector (WordPress)** | Health verzamelen, staging bouwen/afbreken, updates uitvoeren, snapshot + rollback, onderhoudsmodus | Geen beslissingen: voert alleen gesigneerde commando's uit |
| **Supabase** | Enige bron van waarheid, RLS, opslag | — |

---

## 3. Datamodel (v2)

Alle tabellen staan in `public`, hebben RLS **aan**, en elke tabel met bureau-data heeft een `agency_id`-kolom (ook de kindtabellen). Zo is elke policy één directe check (`is_member(agency_id)`) zonder joins. Secrets worden versleuteld opgeslagen (AES-256-GCM, sleutel `VERPLOY_ENCRYPTION_KEY` in env) en zijn nooit leesbaar voor de rol `authenticated`.

### 3.1 Tabellen

| Tabel | Belangrijkste kolommen | RLS (authenticated) |
|---|---|---|
| `agencies` | id, name, slug, dashboard_locale (nl/en/de/fr/es), brand_logo_path, brand_color, report_from_name, plan (enum), plan_status, sites_limit, stripe_customer_id, stripe_subscription_id, trial_ends_at | SELECT: lid · UPDATE: owner/admin (kolommen voor billing alleen via service role) |
| `agency_members` | agency_id, user_id, role (owner/admin/member), created_at | SELECT: lid van hetzelfde bureau · INSERT/UPDATE/DELETE: owner (laatste owner kan niet weg: trigger) |
| `agency_invitations` | agency_id, email, role, token_hash, expires_at, accepted_at | owner/admin |
| `sites` | agency_id, name, url, client_name, client_email, report_locale, status, connector_version, wp_version, php_version, last_heartbeat_at, paired_at, test_config (jsonb), auto_update_policy | SELECT: lid · INSERT/UPDATE/DELETE: owner/admin. INSERT gaat door de trigger `enforce_site_limit` |
| `site_credentials` | site_id, agency_id, secret_ciphertext, secret_version, pairing_code_hash, pairing_expires_at | **geen enkele policy**: alleen de service role |
| `health_snapshots` | agency_id, site_id, captured_at, php_version, wp_version, memory_limit_mb, memory_usage_mb, ssl_expires_at, domain_expires_at, db_size_mb, disk_free_mb, raw (jsonb) | SELECT: lid |
| `site_components` | agency_id, site_id, type (plugin/theme/core), slug, name, version, latest_version, update_available, active | SELECT: lid |
| `alert_rules` | agency_id, metric, warn_threshold, critical_threshold, enabled | SELECT: lid · write: owner/admin |
| `alerts` | agency_id, site_id, rule/metric, severity, status (open/resolved/dismissed), dedupe_key, title_key + params (i18n), triggered_at, resolved_at, notified_at | SELECT/UPDATE(status): lid |
| `update_runs` | agency_id, site_id, created_by, status (state machine §5), items (jsonb: type/slug/from/to), attempt, max_attempts, lease_until, worker_id, step_state (jsonb), idempotency_key, verdict (passed/blocked/rolled_back/error), started_at, finished_at | SELECT: lid · INSERT: via RPC `create_update_run` (controle op rol + open run per site) · UPDATE: alleen service role |
| `update_run_events` | agency_id, run_id, step, level, message_key, data, created_at | SELECT: lid (append-only tijdlijn) |
| `test_results` | agency_id, run_id, phase (baseline/staging/postcheck), page_url, check, passed, detail, screenshot_path, diff_path, diff_ratio | SELECT: lid |
| `diagnoses` | agency_id, run_id, cause, explanation, suggested_fix, confidence, model, created_at | SELECT: lid (fase 5) |
| `reports` | agency_id, site_id, period_start, period_end, locale, status, pdf_path, sent_to, sent_at, trigger (manual/monthly) | SELECT: lid · INSERT: via RPC (fase 6) |
| `signed_request_nonces` | site_id, nonce, seen_at (TTL 10 min) | geen policy: alleen service role |

Storage-buckets `screenshots`, `reports` en `branding` zijn **privé**. Het pad begint altijd met `agency_id/`, en de storage-policy controleert `is_member((storage.foldername(name))[1]::uuid)`. De UI gebruikt signed URL's.

### 3.2 Hulpfuncties (SECURITY DEFINER, `search_path = ''`)

`is_member(agency_id)`, `has_role(agency_id, roles[])`, `create_update_run(site_id, items)`, `claim_update_run(worker_id, lease_seconds)`, `enforce_site_limit()` (trigger), `sites_limit_for(plan)`.

### 3.3 Abonnementen (opdracht: €19–249/maand, tiers op aantal sites)

| Tier | Prijs/maand | Sites |
|---|---|---|
| Solo | €19 | 5 |
| Studio | €49 | 15 |
| Agency | €99 | 40 |
| Scale | €249 | 120 |

Prijzen en limieten staan op één plek: de tabel `plans` (tier, naam, prijs in centen, sites-limiet, Stripe-prijs-id). De UI, de limiet-trigger en Stripe lezen allemaal daaruit, dus aanpassen = één migratie van één regel per tier.

Proefperiode van 14 dagen met Studio-limieten, zonder creditcard. Na afloop zonder abonnement geldt: alleen-lezen (monitoring loopt door, geen nieuwe sites of update-runs).

### 3.4 Migratie van de bestaande productiedata

Een eenmalige migratie `2026xxxx_v2.sql` maakt het v2-schema naast v1 aan. Daarna kopieert hij agencies, members en sites (met nieuwe `site_credentials`: bestaande sites krijgen status `needs_pairing`), migreert de laatste snapshot per site en dropt daarna de v1-objecten (`site_overview`, `update_jobs`, `update_runs` v1, `process_heartbeat`, …). Dat is veilig bij de huidige omvang (1 bureau, 3 sites, 0 jobs).

---

## 4. Plugin ↔ backend: ondertekende requests

- **Koppelen (pairing):** het dashboard maakt per site een eenmalige koppelcode (8 tekens, 30 min geldig, alleen de hash wordt opgeslagen). De plugin stuurt `POST /api/v2/connect {code, site_url, nonce}`. De backend genereert een secret van 32 bytes, slaat het versleuteld op en geeft het één keer terug; de plugin bewaart het in `wp_options` (autoload uit). Daarna wordt de code ongeldig.
- **Handtekening (beide richtingen):**
  `signature = hex(HMAC-SHA256(secret, method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + sha256_hex(body)))`
  Headers: `X-Verploy-Site`, `X-Verploy-Timestamp` (unix seconden), `X-Verploy-Nonce` (16 random bytes, hex) en `X-Verploy-Signature`.
- **Validatie:** |nu − timestamp| ≤ 300 s, de nonce is nog niet gezien (backend: tabel `signed_request_nonces`; plugin: transient met TTL van 10 min), en de vergelijking gebeurt in constante tijd (`hash_equals` / `timingSafeEqual`). Anders volgt 401 zonder details.
- **Update-commando's** naar de plugin worden alleen uitgevoerd met een geldige handtekening. Daarnaast bevatten ze `run_id`. De plugin weigert een commando waarvan het `run_id` niet overeenkomt met de actieve lock (zie §5).
- **Rotatie:** "Sleutel vernieuwen" in het dashboard maakt `secret_version+1`. De oude sleutel blijft 10 minuten geldig.

---

## 5. Kernflow: update-run state machine

```
queued ─▶ preparing ─▶ baseline ─▶ staging_create ─▶ staging_baseline ─▶ staging_update ─▶ staging_test
                                                                         │
                               ┌──────────── gezakt ──────────────────────┤
                               ▼                                          ▼ geslaagd
                          blocked (niets live)                     deploy_snapshot ─▶ deploy_apply ─▶ postcheck
                               │                                                                 │        │
                               ▼                                                         geslaagd│        │gezakt
                         cleanup ─▶ done                                          deployed ◀────┘        ▼
                                                                                                    rollback ─▶ rolled_back
  Elke stap kan eindigen in error (na max. retries) → cleanup → done(verdict=error)
```

| Stap | Wat er gebeurt | Idempotent doordat |
|---|---|---|
| preparing | Site-lock nemen in de plugin (`run_id`), check vrije schijfruimte en of de plugin-versie ≥ 2.0 is | Lock met hetzelfde `run_id` opnieuw nemen = no-op |
| baseline | Playwright op **productie**: pagina's ontdekken (home, menu-links, max. 8), per pagina checks + screenshot (desktop 1280 en mobiel 390) | Resultaten upsert op (run, phase, page, check) |
| staging_create | Plugin kopieert bestanden naar `wp-content/verploy-staging/<run_id>/` (uploads worden niet gekopieerd maar via URL naar productie gemapt) en DB-tabellen naar prefix `vpst_<kort>_`. Gebeurt in stukjes (`step` + cursor) binnen max_execution_time | Cursor wordt opgeslagen in `step_state`; een stuk opnieuw draaien overschrijft hetzelfde doel |
| staging_update | Plugin voert de updates uit op de staging-kopie (Plugin_/Theme_/Core_Upgrader met staging-constanten) | Is de versie al de doelversie → overslaan |
| staging_test | Dezelfde checks + screenshots op staging, en vergelijken met de baseline: nieuwe PHP-fatals, HTTP ≥ 500, nieuwe JS-fouten, verdwenen kernelementen, pixel-diff per pagina > drempel (standaard 2 %, instelbaar per site; dynamische zones zoals sliders zijn te maskeren) | Deterministische herberekening |
| blocked | Niets live, alert + e-mail, diagnose-input bewaard (fase 5) | — |
| deploy_snapshot | Onderhoudsmodus aan (bezoekers zien 503 + Retry-After, testverkeer met token mag door), backup van betrokken plugin-/themamappen + DB-dump van tabellen met siteprefix | Snapshot-id = run_id; bestaat hij al → hergebruiken |
| deploy_apply | Updates op productie | Versie = doel → overslaan |
| postcheck | Checks + screenshots op productie tegen de baseline | Herberekening |
| rollback | Bestanden + DB terugzetten uit de snapshot, cache legen, opnieuw checken dat de site werkt | Terugzetten is overschrijven |
| cleanup | Staging-map + tabellen weg, snapshot na 7 dagen weg, onderhoudsmodus uit, lock vrij | Verwijderen van wat al weg is = no-op |

**Jobs:** `claim_update_run` gebruikt `FOR UPDATE SKIP LOCKED` en zet `lease_until = now() + 120 s`. De worker verlengt de lease elke 30 s. Een cron zet runs met een verlopen lease terug naar hun laatste stap (`attempt+1`); boven `max_attempts` (3) volgt `error` + cleanup. Elke stap heeft een eigen timeout (staging_create 20 min, tests 10 min, overige 5 min). Per site kan er maar één run tegelijk actief zijn (partial unique index).

**Waarom onderhoudsmodus tijdens deploy + postcheck:** tussen snapshot en eventuele rollback mag er geen productiedata bijkomen (bijvoorbeeld WooCommerce-orders), anders zou een DB-rollback die data wissen. Het venster is typisch 1–3 minuten. Zie DECISIONS.md.

---

## 6. Monitoring

Heartbeat elke 15 min: PHP-versie, WP-versie, memory_limit + piekgebruik, schijfruimte, DB-grootte, plugins/thema's/core met update-status, en ssl + domein-verloop. SSL- en domeindata controleert de backend zelf (TLS-handshake en RDAP-lookup), omdat de plugin dat niet betrouwbaar kan. Standaard drempelregels per bureau: SSL < 14 d (waarschuwing) / < 3 d (kritiek), domein < 30 / < 7 d, PHP < 8.1 / < 8.0, geheugenlimiet < 256 MB, geheugengebruik > 80 %, geen heartbeat > 45 min (offline). Alerts zijn gededupliceerd op `dedupe_key`, sluiten automatisch als de waarde herstelt, en sturen één e-mail per nieuwe alert via Resend.

---

## 7. i18n

- De rapporten (fase 6) gebruiken `locales/{nl,en,de,fr,es}/report.json`, en alle vijf de talen zijn volledig ingevuld. Een test faalt bij een ontbrekende key in welke taal dan ook.
- Het dashboard gebruikt `locales/*/app.json` met dezelfde vijf talen en één taal per bureau (`agencies.dashboard_locale`).
- Alerts slaan `title_key + params` op, zodat e-mail en UI ze in de taal van het bureau renderen.

---

## 8. Test- en releasestrategie

| Laag | Tool | Draait tegen |
|---|---|---|
| Unit (HMAC, semver, diff, i18n-volledigheid) | Vitest | Node |
| RLS / multi-tenant | Vitest + `pg` | Lokale Postgres 16 met Supabase-compatibele `auth`-schema-shim en de echte migraties. Bewijst dat bureau A niets van bureau B kan lezen of schrijven, per tabel en per bewerking |
| Plugin | PHP-integratietests | Echte WordPress 7.1.2 (SQLite-drop-in) op de PHP built-in server in de sandbox |
| E2E kernflow | Playwright | Worker lokaal tegen dezelfde WordPress-testsite, met drie scenario's: nette update, update die de site breekt (test-plugin v2 met fatal), en update die pas na deploy faalt (test-plugin die alleen op productie-host breekt) |
| Dashboard | Playwright | `next start` lokaal tegen lokale Postgres + Supabase Auth-shim (GoTrue niet beschikbaar in sandbox → zie DECISIONS) |

**Releaseregel plugin:** geen ZIP gaat naar `dashboard/public/downloads/` zonder groene plugin-integratietest op WordPress (ingevoerd na het 1.3.0-incident).

---

## 9. Fasering in detail

**Fase 2: Fundament**
Repo opruimen, pakketten upgraden (Next 16, React 19, Tailwind 4, supabase-js 2.117, TS strict), migratie v2 (schema + RLS + functies + datamigratie), Supabase-shim + RLS-testsuite, registratie → bureau → teamleden uitnodigen, site toevoegen → koppelcode, connector 2.0 (pairing + HMAC-heartbeat), `/api/v2/connect` + `/api/v2/heartbeat`, plugin-integratietest, E2E "registreer → koppel → heartbeat zichtbaar".

**Fase 3: Monitoring + dashboard**
Snapshots + componenten verwerken, SSL/domein-check-cron, drempelregels + alerts + Resend-e-mail, dashboardoverzicht, site-detail, alertlijst.

**Fase 4: Veilige updates**
Plugin-endpoints (lock, staging, update, snapshot, rollback, onderhoudsmodus, cleanup), worker-state-machine, Playwright-checks + pixel-diff, run-tijdlijn in de UI, drie E2E-scenario's, testsite + stappenlijst voor Martijn → **controlemoment**.

**Fase 5–8:** zie de tabel bovenaan.

---

## 10. Resultaat fase 2 (24-09-2026) — branch `v2`

**Gebouwd:** v2-schema (`supabase/migrations/20260924000000_v2_foundation.sql`, werkt op lege DB én op de v1-productiestaat), Next 16-dashboard (registreren, inloggen, wachtwoord vergeten, onboarding, sites, site-detail met koppelen, team + uitnodigingen, bureau-instellingen; 5 talen), plugin-API (`/api/v2/connect`, `/api/v2/heartbeat`, `/api/v2/ping`), Verploy Connector 2.0.0 (koppelcode, HMAC in beide richtingen, schema-2-heartbeat, PHP 7.4-compatibel), lokale Supabase-stack (`supabase/local/`), CI en migratie-workflow (`.github/workflows/`).

**Bewijs (lokaal gedraaid):**

| Suite | Resultaat | Wat het bewijst |
|---|---|---|
| `npm run test:db` | 78/78 | RLS per tabel en bewerking: bureau A kan niet bij B (owner/admin/member), anon nergens, secrets voor niemand leesbaar, kolomrechten, rollen, tier-limieten ook voor service_role, koppelcode eenmalig, heartbeat-ingest, typen actueel. Mutatietest: ingebouwd lek → 5 tests falen |
| `npm run test:unit` | 66/66 | HMAC (vaste openssl-vector), replay/tijdvenster/manipulatie, AES-GCM, URL-normalisatie, heartbeat-schema, i18n volledig in 5 talen incl. meervoud |
| `connector-plugin/tests/run-tests.php` | 19/19 | In echte WordPress 7.1.2: zelfde HMAC-vector als TypeScript, inkomende verificatie, collector, REST 401/200 |
| PHPCompatibility 7.4- | 0 fouten | 2.0 draait op PHP 7.4 (1.x niet: union types) |
| Playwright E2E | 6/6, 5× achter elkaar | Registreren → bureau → site → koppelcode → koppelen in wp-admin → data in dashboard; teamlid via uitnodiging; ander bureau krijgt 404; vervalste/ongesigneerde heartbeats 401; plugin 1.x krijgt 410 |
| `next build`, `tsc`, `eslint` | groen | |

**Uitrol naar productie (zodra BLOCKERS #2 opgelost is):** migratie toepassen → `v2` mergen naar `main` (Vercel deployt) → registratie weer aanzetten + redirect-URL `https://app.verploy.com/auth/callback` in Supabase Auth → 3 sites opnieuw koppelen (BLOCKERS #1).

## 11. Lokaal ontwikkelen en testen

Zie `README.md`.

## 12. Resultaat fase 3 (24-09-2026) — branch `v2`

**Gebouwd:** migratie `20260925000000_monitoring.sql`:
- `alerts` met één open melding per site+type
- `app.evaluate_site` als enige plek voor alle drempels
- `sweep_alerts`, met pg_cron elke 5 min als de extensie beschikbaar is
- e-mailwachtrij met claim/bevestig/opnieuw, max. 5 pogingen
- `record_site_checks`

Daarnaast:
- SSL-controle via een echte TLS-handshake (`src/lib/monitoring/ssl.ts`)
- domeinverloop via RDAP en de IANA-bootstrap (`rdap.ts`)
- e-mail via Resend in de taal van het bureau (`notify.ts`)
- onderhoud met `/api/cron/maintenance` (Vercel Cron dagelijks, beveiligd met `CRON_SECRET`)
- directe mail na een heartbeat via `after()`
- UI: meldingenpagina (open/opgelost), teller in de zijbalk, "Gezien", gezondheidspaneel en open meldingen per site, ernst per site in het overzicht

**Drempels (defaults, in SQL):**

| Onderwerp | Waarschuwing | Kritiek |
|---|---|---|
| Offline | — | 45 min geen heartbeat |
| SSL | verloopt < 14 d, of geen HTTPS | verloopt < 3 d, of ongeldig |
| Domein | < 30 d | < 7 d (alleen als de registry een verloopdatum publiceert) |
| PHP | EOL binnen 180 d | EOL verstreken (php.net: 8.1 en ouder) |
| Geheugenlimiet | < 128 MB | < 64 MB |
| Schijf | < 1 GB | < 256 MB |
| Updates | core-update | — |

Plugin- en thema-updates zijn info (alleen in-app). Er gaat een e-mail uit voor nieuwe waarschuwingen en kritieke meldingen, bij escalatie, en bij herstel na offline.

**Bewijs:**

| Suite | Resultaat |
|---|---|
| vitest (unit + DB) | 176/176 |
| DB-tests monitoring | 16 nieuw: alle drempels, escalatie, herstel, wachtrij, rechten |
| SSL | echte TLS-handshake met gegenereerd certificaat (verloop, uitgever, zelf-ondertekend, verkeerde host, onbereikbaar) |
| RDAP | .com met datum, .nl zonder datum, co.uk, netwerkfout |
| Playwright fase 3 | 5/5: http-site → waarschuwing in-app + e-mail (via mock van de Resend-API, echte SDK); cron zonder geheim → 401; 2 uur geen heartbeat → cron → kritieke offline-melding + e-mail + teller; heartbeat → herstelmail en "Opgelost"; "Gezien"; ernst in overzicht |

**Bekende beperking tot de worker draait (fase 4 / BLOCKERS #3):** pg_cron maakt offline-meldingen elke 5 min in-app aan. De e-mail daarvoor gaat mee met de eerstvolgende heartbeat van een willekeurige site, of met de dagelijkse cron. Liggen álle sites tegelijk plat, dan kan de e-mail tot de dagelijkse run uitblijven. De worker roept `/api/cron/maintenance` elke 5 min aan en heft dit op.


---

## 13. Resultaat fase 4 (24-09-2026) — branch `v2`

**Gebouwd:**
- **Connector 2.1.0** (`connector-plugin/verploy-connector/includes/class-run-engine.php` e.a.): staging als volledige kopie (bestanden + tabellen, in stukjes), updates via de eigen upgraders van WordPress, snapshot (betrokken mappen + alle tabellen), onderhoudsmodus met bypass, rollback (bestanden terug + `RENAME TABLE`), een rollback-noodroute als mu-plugin, opruimen (staging weg, back-ups na 7 dagen), een lijst met testpagina's (menu's, ook blokthema-navigatie, webwinkel, extra paden) en een directe heartbeat. Een run-lock voorkomt twee runs tegelijk.
- **Migratie `20260926000000_update_runs.sql`:**
  - tabellen `update_runs`, `update_run_events` en `test_results`, met RLS (lezen voor leden, schrijven alleen via RPC's en de service role)
  - RPC's `create_update_run` (rol, alleen-lezen-bureau, gekoppeld, connector ≥ 2.1, versies uit de heartbeat, één actieve run per site), `cancel_update_run`, `claim/renew/advance/release_update_run` en `record_run_outcome`
  - testinstellingen per site
  - de bucket `run-artifacts`
  - een site met een lopende run kan niet worden verwijderd
- **Worker** (`dashboard/worker/`): state machine uit §5 plus een extra stap `staging_baseline` (staging meten vóór de update). Playwright-checks en pixelmatch, time-outs per stap, pogingen, lease, annuleren vóór de deploy, meldingen en e-mail na afloop. Ook een healthcheck en elke 5 minuten monitoringonderhoud.
- **Dashboard:** updates aanvinken en veilig laten uitvoeren op de sitepagina, updategeschiedenis en testinstellingen. De run-pagina ververst live en toont stappen, updates per omgeving, tests per pagina/viewport met schermafbeeldingen vóór, na en verschil, en een tijdlijn. Er zijn meldingen voor tegengehouden, teruggedraaid en mislukt. Alles in 5 talen.

**Bewijs:**

| Suite | Resultaat |
|---|---|
| Engine-integratietest (`connector-plugin/tests/engine-test.php`, WordPress 7.1.2 op MySQL-compatibele DB) | 27/27. Maakt deel uit van `build.sh`: zonder groene engine-test geen release |
| DB-tests | 124/124, waarvan 18 nieuw voor runs: rechten, bureau-isolatie, lease/overname, annuleren, integriteit |
| Unit | 100/100, waaronder pixelvergelijking, vergelijkingsregels, foutherkenning en signing van de worker |
| Playwright, alle fasen | 15/15. Fase 4: koppelen → **scenario 1** goede update live (footer 1.0.0 → 1.1.0 op de echte site) · **scenario 2** fatale update tegengehouden, productie nooit aangeraakt, melding · **scenario 3** update die alleen live breekt (de site crasht volledig, ook de REST-API) → automatisch teruggedraaid, site werkt weer, e-mail met link naar de run |

**Lokaal draaien:** zie README (MySQL-WordPress + `tests/lab/build-lab.sh`, daarna `npm run worker:build` en `npx playwright test`).

---

## 14. Resultaat fase 5 (24-09-2026) — branch `v2`

**Gebouwd:**
- **Connector 2.2.0** legt fatale PHP-fouten vast op het moment dat het misgaat: op staging via de staging-beveiliging, op productie via de noodroute (tijdens de deploy). De bestandsnamen zijn onvoorspelbaar en afgeleid van het site-secret. De route `/run/diagnostics` geeft fouten zonder serverpaden, het einde van het debuglog van staging en de omgeving (versies, actieve plugins, thema). Die route werkt ook als de site volledig plat ligt.
- De **worker** haalt deze gegevens op vóór het opruimen of terugzetten en maakt na afloop de diagnose. Die komt mee in de melding en de e-mail.
- **Diagnose** (`src/lib/diagnosis/`):
  - Stap 1 is altijd regelgebaseerd: welke plugin of welk thema (uit het foutpad), welk soort fout (ontbrekende functie, methode of klasse, geheugen, dubbele functie, PHP-versie, syntaxfout, conflict met een níet bijgewerkte plugin), of anders de eerste gezakte test.
  - Het resultaat is een samenvatting, oorzaak, oplossing, schuldige en zekerheid, in de taal van het bureau (5 talen).
  - Stap 2 (met `ANTHROPIC_API_KEY`) laat Claude (`claude-sonnet-5`, structured outputs met JSON-schema) de diagnose verfijnen op basis van hetzelfde bewijs. Geeft de API een fout, een weigering of een ongeldig antwoord, dan blijft de regelgebaseerde diagnose staan. Een plugin die niet in het bewijs voorkomt, wordt nooit als schuldige genoemd.
- **Tabel `diagnoses`** (één per run, RLS: lezen voor leden, schrijven alleen door de service role).
- **UI:** diagnosekaart op de run-pagina (samenvatting, oorzaak, wat je kunt doen, schuldige, zekerheid, foutmelding, bron).

**Bewijs:** engine-test 30/30 (inclusief diagnose op staging en via de noodroute terwijl productie plat ligt) · unit 111/111 (herkenning, alle categorieën in 5 talen, Claude-aanroep en foutpaden met nagebootste API-antwoorden) · DB 130/130 · Playwright 15/15. Scenario 2 en 3 tonen nu een diagnose met de juiste plugin en functie, en de e-mail van scenario 3 bevat de diagnose.

---

## 15. Resultaat fase 6 (24-09-2026) — branch `v2`

**Gebouwd:**
- **Migratie `20260928000000_reports.sql`:**
  - maandrapport aan/uit per site
  - tabel `reports` als wachtrij en archief (RLS: lezen voor leden)
  - `request_report`: elk lid mag een rapport maken, versturen naar de klant alleen eigenaar/beheerder, max. 30 per uur per bureau
  - `schedule_monthly_reports`: idempotent, één maandrapport per site per maand
  - `claim_report` / `complete_report`: lease en max. 3 pogingen
  - privé-buckets `reports` en `branding`
- **Rapport** (`src/lib/reports/`) in NL/EN/DE/FR/ES:
  - beschikbaarheid uit de offline-meldingen (heartbeat elke 15 min)
  - updates in de periode met resultaat, en bij tegengehouden of teruggedraaide updates de diagnose, opnieuw opgebouwd in de taal van het rapport
  - staat van de site (WordPress, PHP met EOL, SSL, domein, geheugen, schijf, openstaande updates)
  - aandachtspunten en onderbrekingen
  - white-label: logo, kleur en afzender van het bureau, nergens "Verploy"
- **PDF** met Puppeteer (`puppeteer-core` 25.12, dezelfde Chromium als Playwright). De HTML bevat alles zelf (lettertype Inter en logo als data-URI), en netwerkverzoeken zijn geblokkeerd. A4 met paginanummers.
- **Worker:** rapporten verwerken (update-runs gaan voor) en elke 5 min de maandplanner draaien. Versturen gebeurt via Resend met de PDF als bijlage, afzendernaam van het bureau, reply-to naar de eigenaar en een idempotentiesleutel (nooit dubbel verstuurd).
- **UI:**
  - pagina Rapporten (maken: vorige maand / deze maand / eigen periode, optioneel versturen; lijst met status en download)
  - paneel "Klant en rapporten" per site (naam, e-mail, taal, maandrapport)
  - logo-upload (bestandstype wordt aan de inhoud herkend: PNG, JPG of WebP, max. 1 MB) en afzendernaam in de instellingen

**Bewijs:** unit 121/121 (beschikbaarheid, render in 5 talen, escaping, onveilige kleur, footer) · DB 139/139 (rechten, periode, maandplanner idempotent, wachtrij) · Playwright 17/17. Fase 6: Duitse klant, logo, rapport versturen → e-mail met afzender "Agentur Nord" en een PDF-bijlage die met `pdftotext` is gecontroleerd (Duits, klantnaam, geen "Verploy"), downloaden werkt, een SVG vermomd als PNG wordt geweigerd, en een ander bureau krijgt 404.
