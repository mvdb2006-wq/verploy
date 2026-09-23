# Verploy — DECISIONS

Eén regel onderbouwing per keuze. Nieuwste onderaan per sectie.

## Versies (gecontroleerd op npm op 23-09-2026 via `npm view <pkg> version`)

| Pakket | Versie | Opmerking |
|---|---|---|
| next | 16.3.6 | latest stable (dist-tag `latest`) |
| react / react-dom | 19.3.0 | vereist door Next 16 |
| typescript | 6.0.3 | 7.0.2 is latest, maar heeft geen JS-API meer (`createProgram` ontbreekt) die Next.js en typescript-eslint nodig hebben; typescript-eslint ondersteunt `<6.1.0` |
| tailwindcss / @tailwindcss/postcss | 4.3.3 | v4 CSS-first config; tokens gaan naar `@theme` |
| @supabase/supabase-js | 2.117.1 | |
| @supabase/ssr | 0.12.7 | |
| stripe | 22.6.2 | |
| resend | 6.28.1 | officiële SDK i.p.v. handgeschreven fetch |
| zod | 4.6.5 | validatie van alle API-input |
| @playwright/test / playwright | 1.63.0 | worker + E2E |
| puppeteer | 25.12.0 | PDF-rapporten (in worker) |
| pixelmatch | 7.2.0 | visuele diff |
| pngjs | 7.0.0 | |
| vitest | 5.0.1 | unit- en RLS-tests |
| pg | 8.23.0 | RLS-tests direct op Postgres |
| @anthropic-ai/sdk | 0.128.0 | AI-diagnose (fase 5) |
| lucide-react | 1.47.0 | iconen (bestond al) |
| @fontsource-variable/inter | 5.3.0 | Inter zelf gehost: geen Google-verzoek, build werkt offline |
| GoTrue / PostgREST (lokaal) | v2.197.0 / v16.3 | zelfde auth- en API-laag als Supabase, als release-binaries |
| clsx 2.1.1, tailwind-merge 3.7.0, date-fns 4.4.0 | | bestonden al |
| eslint 10.11.0, eslint-config-next 16.3.6 | | |
| Node | 22 LTS | zowel Vercel als Railway |
| WordPress (test) | 7.1.2 | zelfde versie als emhostingendesign.nl |
| PHP (plugin-minimum) | 7.4 | WordPress.org-publiek draait nog op 7.4; code blijft 7.4-compatibel |

## Architectuur

- **Bestaand Supabase-project en data behouden, schema herschrijven (v2).** De huidige schema's hebben een datalek, kapotte policies en ontbrekende tabellen in de repo. De data is klein (1 bureau, 3 sites), dus migreren is goedkoop.
- **`agency_id` op elke tabel, ook de kindtabellen.** RLS wordt dan één directe check zonder joins: sneller, en minder kans op een vergeten join in een policy.
- **Geen views met `security definer`-gedrag.** Elke view krijgt `security_invoker = true`, zodat RLS altijd geldt.
- **Site-secrets versleuteld (AES-256-GCM) en in een aparte tabel zonder policies.** Een lek van één query of een debug-log onthult geen bruikbare sleutels, en `authenticated` kan de tabel nooit lezen.
- **Koppelen via een eenmalige koppelcode in plaats van een API-key kopiëren.** Het secret verlaat de server maar één keer, rechtstreeks naar de plugin, en staat nooit in de UI.
- **HMAC-SHA256 over method+path+timestamp+nonce+body-hash, ±300 s venster, nonce-opslag.** Dat is de standaard (vergelijkbaar met Stripe/AWS SigV4-light) en beschermt tegen replay en manipulatie.
- **Staging als kopie op dezelfde server (submap + tabelprefix), niet in een worker-container.** De test draait dan op exact dezelfde PHP-versie, extensies en limieten als productie. Dat bewijst meer dan een nagebouwde omgeving, en het werkt bij elke host zonder SSH.
- **Uploads niet kopiëren naar staging, maar naar de productie-URL mappen.** Uploads zijn de grootste map en veranderen niet door plugin-updates.
- **Staging in stukken bouwen (cursor-gebaseerd).** Gedeelde hosting heeft `max_execution_time` 30–60 s. Stukken maken het bouwen hervatbaar en idempotent.
- **Onderhoudsmodus van snapshot tot en met post-check.** Zonder onderhoudsmodus kan een DB-rollback orders of formulierinzendingen van de laatste minuten wissen. Een onderhoudsvenster van 1–3 minuten is het kleinere kwaad.
- **Rollback = bestanden + DB-tabellen van de site terugzetten uit de snapshot van vlak voor de deploy.** Alleen bestanden terugzetten laat DB-migraties van plugins achter, en dat is precies wat vaak breekt.
- **Tests vergelijken met een baseline in plaats van absolute regels.** Veel echte sites hebben al JS-fouten of trage pagina's; alleen *nieuwe* problemen zeggen iets over de update.
- **Pixel-diff-drempel standaard 2 % per pagina, instelbaar per site, met maskeerbare selectors.** De oude 5 % miste kleine layoutbreuken; maskers voorkomen vals alarm door sliders en datums.
- **Job-queue in Postgres (`FOR UPDATE SKIP LOCKED` + lease) in plaats van Redis of een queue-dienst.** Er komt geen extra dienst bij, het is transactioneel met de run-status en het is ruim voldoende voor honderden runs per dag.
- **Worker pollt de database en krijgt geen HTTP-trigger van Vercel.** Dat heeft één pad minder, geen gedeeld worker-secret nodig, en werkt ook als Vercel even hapert.
- **PDF's met Puppeteer in de worker, niet op Vercel.** De worker heeft al Chromium, en PDF-rendering is te zwaar en traag voor serverless.
- **AI-diagnose via de Anthropic API in plaats van OpenAI.** Dat is niet vastgelegd in de stack; de Anthropic-API is bereikbaar vanuit de ontwikkelomgeving (OpenAI niet), dus hij is echt te testen.
- **Twee plugin-builds: `wporg` (zonder zelf-updater) en `direct` (met updater).** WordPress.org verbiedt updates van externe servers (richtlijn 8), maar EM Hosting heeft updates nodig vóór de WP.org-goedkeuring.
- **Marketingsite op verploy.com buiten scope (besluit Martijn 23-09).** Alle focus op app.verploy.com.
- **Registratie dicht tot fase 2 klaar is (besluit Martijn 23-09).** Uitgezet in Supabase Auth; gaat weer open met het nieuwe v2-fundament.
- **Dashboard in vijf talen (NL/EN/DE/FR/ES), één taal per bureau.** De rapporten moeten al vijf talen hebben, dus met dezelfde i18n-infrastructuur is het dashboard in dezelfde talen weinig extra werk.
- **Tiers Solo €19/5 · Studio €49/15 · Agency €99/40 · Scale €249/120 sites.** Dat past binnen de opdracht (€19–249). Een lineaire prijs per site van ongeveer €4 → €2 beloont groei. De landingspagina-prijzen (€29–199) worden losgelaten.
- **Prijzen en limieten centraal in tabel `plans`, niet in code.** Martijn wil ze later makkelijk aanpassen; één bron voorkomt dat UI, limiet-trigger en Stripe uit elkaar lopen. Tiers voorlopig akkoord (23-09).
- **Tier-limiet via DB-trigger `enforce_site_limit` op `sites` INSERT.** Die geldt dan voor elk pad (UI, API, service role), niet alleen in de UI.
- **Proefperiode 14 dagen met Studio-limieten; daarna alleen-lezen.** Een bureau kan zo echt testen zonder creditcard, en er gaat nooit data verloren.

## Ontwikkelomgeving en tests

- **Cloud-sandbox kan npm, Docker Hub, WordPress.org, Supabase en app.verploy.com niet bereiken (proxybeleid, 403).** Pakketten installeer ik op de gekoppelde laptop-VM (npm en GitHub werken daar) en die gaan als tarball naar de sandbox. De sandbox heeft PHP 8.4, Postgres 16 en Chromium.
- **RLS-tests op lokale Postgres 16 met een Supabase-compatibele `auth`-shim** (`auth.uid()` en `auth.jwt()` lezen `request.jwt.claims`, plus de rollen `anon`, `authenticated` en `service_role`). Dat is hetzelfde mechanisme als Supabase zelf gebruikt, dus de echte migraties en policies worden getest.
- **Test-WordPress op SQLite (officiële `sqlite-database-integration`) + PHP built-in server.** Er is geen MySQL of Docker Hub beschikbaar; SQLite draait echte WordPress-core en echte plugin-upgrades.
- **Productiedatabase: lezen van gebruikersdata en schrijven zijn voor mij geblokkeerd (auto-mode-beleid).** Migraties naar productie gaan via een GitHub Action (`supabase db push`) zodra Martijn de secrets toevoegt (BLOCKERS), of via zijn expliciete akkoord per migratie.
- **Commits worden in de sandbox gemaakt en via een patch op de laptop gepusht.** De sandbox heeft geen schrijfrechten op GitHub; de laptop wel.

## Fase 2

- **Eén bureau per gebruiker (`unique(user_id)`).** Houdt sessie, RLS-helpers en UI eenvoudig; een tweede bureau vraagt een tweede account. Kan later versoepeld worden.
- **Gevoelige mutaties via SECURITY DEFINER-RPC's, niet via policies.** Bureau aanmaken, uitnodigen, rollen, koppelcodes: één plek met expliciete checks, en de tests roepen exact die functies aan.
- **Kolomrechten naast RLS.** `authenticated` kan bijv. `agencies.plan_id` of `sites.status` niet wijzigen, ook niet als owner; alleen de server (service role) zet die.
- **Bestaand bureau (EM Hosting) wordt `scale` + `comped`.** Oprichtersaccount mag niet op slot gaan vóór Stripe (fase 7).
- **Encryptiesleutel valt terug op een HKDF-afleiding van de service-role-key; ciphertext draagt een sleutel-id.** Geen extra blocker nu; een eigen `VERPLOY_ENCRYPTION_KEY` kan later zonder dataverlies (d1 blijft leesbaar).
- **Heartbeat met afwijkend site-adres wordt geweigerd (409).** Een gekloonde site (bijv. staging) met hetzelfde secret kan de echte site niet overschrijven.
- **Inkomende plugin-verzoeken ondertekenen de REST-route (`/verploy/v2/...`), niet het URL-pad.** Werkt dan met `/wp-json/` én `?rest_route=`.
- **Koppelcode: 8 tekens uit 32 (40 bit), 30 min, eenmalig, gebonden aan site-adres.** Brute force binnen het venster is onhaalbaar; geen rate-limit-infrastructuur nodig.
- **`typedRoutes` uit.** Dynamische redirects (`?next=`) zouden overal casts vereisen; `safeNext()` + tests beschermen tegen open redirects.
- **ESLint: React-versie expliciet.** eslint-plugin-react in eslint-config-next 16.3.6 gebruikt een in ESLint 10 verwijderde API bij autodetectie.
- **Vercel bouwt de branch `v2` niet.** Een preview zou tegen het v1-productieschema draaien; uitrol gaat via merge naar `main` ná de migratie.
- **Eigen typegenerator (`scripts/gen-db-types.mjs`) i.p.v. `supabase gen types`.** De CLI heeft Docker nodig; een DB-test bewaakt dat de typen actueel zijn.
- **Plugin-releaseregel in `connector-plugin/build.sh`.** Publiceren naar `dashboard/public/downloads/` kan alleen na groene PHP-tests en PHP 7.4-check.

