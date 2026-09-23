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

## Fase 3

- **Alle drempelregels in één SQL-functie (`app.evaluate_site`).** Heartbeat, pg_cron en de cron-route gebruiken exact dezelfde logica, en de DB-tests dekken hem volledig.
- **Evaluatie aan het einde van `ingest_heartbeat`, niet via een trigger op snapshots.** Anders ziet de evaluatie nog de oude site-status en componenten.
- **"Laatste snapshot" = hoogste id (laatst ontvangen), niet `captured_at`.** De klok van de plugin is niet leidend.
- **SSL en domein controleert de backend zelf, niet de plugin.** Dan meten we wat bezoekers zien (certificaatketen, hostnaam) en werkt het ook als PHP uitgaand verkeer blokkeert.
- **Domeinverloop via RDAP met IANA-bootstrap in plaats van WHOIS-parsing.** RDAP is gestructureerd en gestandaardiseerd. Registries zonder verloopdatum (zoals .nl) krijgen eerlijk "niet gepubliceerd" in plaats van een gok.
- **PHP-EOL-data van php.net (opgehaald 24-09-2026) in `app.php_security_eol`.** Wijzigt alleen bij een nieuwe PHP-release: één regel per branch.
- **Offline pas na 45 min (3 gemiste heartbeats), en gerekend vanaf `paired_at` voor nieuwe sites.** Voorkomt vals alarm door één trage WP-Cron-run of vlak na het koppelen.
- **Plugin-/thema-updates zijn info (geen e-mail).** Ze komen dagelijks voor; mailen zou de echte waarschuwingen laten verdrinken.
- **E-mail naar eigenaren en beheerders, niet naar leden.** Leden zijn meelezers.
- **Wachtrij: claimen met `SKIP LOCKED` + claim-verloop 10 min, bevestigen na versturen, max. 5 pogingen.** Geen dubbele mails bij parallelle runs; een crash laat niets liggen.
- **Zonder `RESEND_API_KEY` wordt niets geclaimd.** Meldingen blijven wachten tot e-mail werkt, in plaats van pogingen te verbranden.
- **Cron-route alleen met `CRON_SECRET` (constante-tijd vergelijking); zonder geheim 503.** Een onbeveiligde onderhoudsroute kan niet per ongeluk live gaan.
- **E2E-mail via een lokale mock van de Resend-API (`RESEND_BASE_URL`) met de echte SDK.** Test het echte verzendpad inclusief onderwerp, ontvangers en taal.


## Fase 4 — veilige updates (24-09-2026)

- **De plugin voert uit, de worker beslist.** Connector 2.1 kent alleen losse, ondertekende en idempotente opdrachten (lock, staging bouwen, update, snapshot, onderhoudsmodus, rollback, opruimen, testpagina's, directe heartbeat). Alle logica (volgorde, vergelijken, oordeel) zit in de worker. Zo is de plugin klein en blijft hij voorspelbaar op elke hosting.
- **Staging = volledige kopie op dezelfde server** (`wp-content/verploy-staging/<8 tekens>/`, tabelprefix `vpst<8>_`), in stukjes van max. 20 s per verzoek (cursor in de database), zodat het ook werkt bij een korte `max_execution_time`. Uploads worden niet gekopieerd maar vanaf productie getoond. Staging stuurt nooit mail, wordt niet geïndexeerd, draait geen cron en is alleen bereikbaar met een token (cookie, alleen voor het eigen domein, dus nooit naar CDN's).
- **Staging gebruikt eenvoudige permalinks** (`?page_id=`), want mooie permalinks in een submap vragen per server andere rewrite-regels. Daarom vraagt de worker pagina's op als objecten (`post:12`, `term:3`) en laat hij beide installaties zelf de URL bepalen. Extra paden die geen WordPress-object zijn, worden alleen op productie getest.
- **Vergelijken binnen dezelfde omgeving.** Staging na de update wordt vergeleken met staging vóór de update, en productie na de update met productie vlak ervoor. Er wordt dus nooit staging met productie vergeleken (andere URL's en uploads). De nulmeting van productie wordt vlak vóór de deploy opnieuw gedaan, onder onderhoudsmodus. Zo telt inhoud die in de tussentijd is gewijzigd niet als fout.
- **Alleen wat vóór de update werkte, moet erna nog werken.** Bestaande problemen (een 404, een oude JS-fout) blokkeren geen update. Gecontroleerd worden: bereikbaarheid, HTTP-status, PHP- en WordPress-foutpagina's, nieuwe JS-fouten, niet-ladende eigen scripts/CSS, verdwenen header/nav/main/footer, halvering van de inhoud, het inlogformulier en de pixelvergelijking (drempel per site, standaard 2%, maskers voor dynamische zones). Op desktop (1280) en mobiel (390).
- **Onderhoudsmodus tijdens snapshot → post-check**, zodat een DB-rollback geen nieuwe bestellingen of formulieren wist. De worker test met een bypass-cookie. Bekende beperking: ingelogde beheerders in wp-admin kunnen in dat venster (1–3 min) nog wijzigingen maken, die een rollback terugdraait.
- **Rollback-noodroute als must-use-plugin.** Tijdens een deploy staat `mu-plugins/verploy-rescue.php` klaar. Die handelt een ondertekend rollback-verzoek af vóórdat gewone plugins laden. Zo werkt terugdraaien ook als een update de hele site laat crashen, inclusief de REST-API. Bewezen in de engine-test met een plugin die al bij het laden crasht. Opruimen verwijdert het bestand.
- **Mislukte of gecrashte update-installatie = stoppen.** Geeft `updates/apply` een 500, dan roept de worker hem nog één keer aan (idempotent). Faalt dat ook, dan wordt de run tegengehouden (staging) of teruggedraaid (productie). Een update die niet aantoonbaar op staging stond, gaat nooit live.
- **Elk lid (ook de rol member) mag een run starten.** Updaten is het dagelijkse werk van een bureau en de flow is veilig by design. Testinstellingen wijzigen mag alleen eigenaar/beheerder. Versies bepaalt de server (laatste heartbeat), nooit de browser.
- **Wachtrij in Postgres, geen aparte queue.** Claim met `FOR UPDATE SKIP LOCKED` en een lease van 120 s die elke 30 s wordt verlengd. Bij een verlopen lease neemt een andere worker het over. Max. 3 pogingen per stap, daarna een foutpad: vóór de deploy opruimen, ná de deploy terugdraaien.
- **Uitkomst → bestaande meldingen.** Tegengehouden, teruggedraaid en mislukt worden meldingen (`update_blocked`, `update_rolled_back` (kritiek), `update_failed`) en gaan via dezelfde e-mailwachtrij en in de taal van het bureau, met een link naar de run. Een geslaagde run lost ze op.
- **Screenshots in een privé-bucket** (`run-artifacts`, pad begint met `agency_id/run_id/`). Alleen de service role leest en schrijft. Het dashboard serveert een afbeelding pas nadat RLS (met de sessie van de gebruiker) heeft bevestigd dat hij bij een testresultaat van het eigen bureau hoort.
- **Lokale storage-stand-in.** De echte Supabase storage-api is in deze sandbox niet te draaien (geen Docker). `supabase/local/gateway.mjs` implementeert alleen de drie aanroepen die Verploy gebruikt (upload, download, verwijderen; alleen service role), zodat de echte supabase-js-code wordt getest. Op productie is dit gewoon Supabase Storage. De bucket maakt de migratie aan zodra `storage.buckets` bestaat.
- **Worker in dezelfde repo en hetzelfde package als het dashboard**, gebundeld met Vite tot `worker/dist/main.mjs`. Zo deelt hij exact dezelfde code voor signing, versleuteling, meldingen en i18n. Hij draait op Railway met het officiële Playwright-image (`worker/Dockerfile`, `worker/railway.json`) en neemt ook het monitoringonderhoud (elke 5 min) over.
- **Taal: Engels als terugval en browsertaal bij het aanmaken van een bureau** (vraag van Martijn, 24-09: wereldwijd verkopen). Het dashboard blijft volledig beschikbaar in NL/EN/DE/FR/ES, per bureau in te stellen. Een nieuw bureau krijgt de taal van de browser, en is die geen van de vijf, dan Engels. Code en database gebruiken al Engelse namen. Documentatie voor Martijn blijft Nederlands.

## Fase 5 — diagnose (24-09-2026)

- **Eerst regels, dan AI.** Een regelgebaseerde diagnose werkt altijd, ook zonder API-sleutel of als de API faalt. Hij haalt de schuldige plugin uit het pad van de fatale fout (het sterkste signaal) en het soort fout uit de melding. AI verfijnt dat op basis van precies hetzelfde bewijs en krijgt het regelconcept mee. Zo is de uitleg nooit slechter dan zonder AI.
- **Model `claude-sonnet-5`** (docs 24-09-2026: beste balans tussen snelheid en kwaliteit, $2/$10 per MTok), in te stellen via `ANTHROPIC_MODEL`. Structured outputs (`output_config.format` met JSON-schema) garanderen een parsebaar antwoord. We valideren daarnaast zelf met zod. Aanroep via `fetch` in plaats van de SDK: één endpoint, geen extra afhankelijkheid.
- **Geen verzonnen feiten:** de prompt verbiedt het verzinnen van bestanden, functies of versies, en een door AI genoemde plugin die niet in het bewijs staat, wordt genegeerd.
- **Privacy:** paden gaan zonder serverindeling naar buiten (`…/wp-content/…`). Er gaat geen inhoud van de site of bezoekersdata naar de AI, alleen foutmeldingen, gezakte checks, versies en de pluginlijst.
- **Fouten vastleggen met een shutdown-handler in een must-use-plugin**, alleen tijdens staging en deploy. Er staat geen permanente logging aan op productie. Logbestanden hebben een naam die van het site-secret is afgeleid (niet te raden) en worden na 7 dagen opgeruimd.
- **Diagnose in de taal van het bureau, één keer gemaakt en opgeslagen**, zodat e-mail en UI hetzelfde zeggen en het niet bij elke paginaweergave opnieuw geld kost.

## Fase 6 — rapporten (24-09-2026)

- **Puppeteer (`puppeteer-core`) met de Chromium van Playwright.** Dat volgt de opdracht (Puppeteer voor PDF's) zonder tweede browser in het image.
- **Rapporten zijn voor de klant van het bureau:** volledig white-label (logo, kleur, afzendernaam), in de rapporttaal van de site en niet in de dashboardtaal. De diagnose wordt in het rapport opnieuw opgebouwd uit het opgeslagen bewijs in de taal van het rapport. De opgeslagen AI-tekst staat in de taal van het bureau.
- **Beschikbaarheid** wordt afgeleid van offline-meldingen (begin = laatste heartbeat, einde = herstel), gemeten vanaf de koppeling. De periodegrenzen zijn hele dagen in UTC; het verschil met Nederlandse tijd (1–2 uur aan de randen) is voor een maandrapport verwaarloosbaar.
- **Versturen alleen door eigenaar/beheerder;** maken mag iedereen. Naar de klant gaat de mail met de afzendernaam van het bureau en reply-to naar de eigenaar, zodat antwoorden bij het bureau terechtkomen. Het adres blijft dat van Verploy (`RESEND_FROM`): een eigen afzenderdomein per bureau vraagt DNS bij elk bureau en valt buiten de opdracht.
- **Logo's** worden alleen als PNG, JPG of WebP geaccepteerd, herkend aan de inhoud. SVG is geweigerd vanwege scriptrisico. Opslag is privé; het rapport krijgt het logo als data-URI.
- **Maandrapporten** gaan op de 1e (Nederlandse tijd) over de vorige kalendermaand, en alleen voor gekoppelde sites van een actief bureau met een e-mailadres van de klant.
