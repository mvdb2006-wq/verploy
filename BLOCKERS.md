# Verploy — BLOCKERS

Wat alleen Martijn kan leveren, gesorteerd op urgentie. Per item: waarom het nodig is, wat je precies moet doen, en wat ik ondertussen doe.

---

## 1. 🟠 Sites opnieuw koppelen na key-rotatie — na fase 2

**Wat er gebeurd is (23-09, met jouw akkoord):** het lek in `site_overview` is gedicht (views volgen nu RLS, `anon` heeft geen rechten meer op public-tabellen), registratie staat uit in Supabase, en alle drie de site-API-keys zijn vervangen door nieuwe willekeurige waarden. De oude keys werken nergens meer. Test: een vreemde ingelogde gebruiker ziet 0 sites en 0 keys, anon krijgt "permission denied", en jij als bureaulid ziet nog steeds je 3 sites. Gebruikerscontrole: er is maar één account (martijn@emhostingendesign.nl).

**Gevolg:** deze sites sturen geen data meer tot ze opnieuw gekoppeld zijn:

| Site | Huidige plugin | Status |
|---|---|---|
| EM Hosting & Design — https://emhostingendesign.nl | verwijderd door jou (na 1.3.0-incident) | geen heartbeats |
| Feel Good TentEvent — https://feelgoodtentevent.nl | oude versie (onbekend) | heartbeats worden geweigerd (401) |
| Borgo Vista Serena — https://borgovistaserena.com | 1.2.0 | heartbeats worden geweigerd (401) |

**Advies:** koppel niet opnieuw met de oude plugin. Die gebruikt nog de platte sleutel waar het lek om draaide. Wacht op connector 2.0 (einde fase 2: koppelcode + HMAC). Ik meld het zodra hij klaarstaat.

**Wat je dan per site doet (± 2 minuten per site):**
1. Log in op wp-admin van de site → Plugins → zoek "Verploy Connector". Staat hij erop: **Deactiveren** → **Verwijderen**.
2. Plugins → Nieuwe plugin → **Plugin uploaden** → kies de ZIP van https://app.verploy.com/api/v1/plugin/download → **Nu installeren** → **Activeren**.
3. Ga in het Verploy-dashboard naar de site → **Koppelcode maken** en kopieer de code van 8 tekens.
4. In wp-admin: Instellingen → Verploy → plak de code → **Koppelen**. Binnen een minuut staat de site in het dashboard weer op "Online".

Wil je dat ik stappen 1, 2 en 4 zelf in de browser doe? Log dan in op wp-admin van de site in de browser van de Claude-app; de rest doe ik.

---

## 2. 🔴 Migraties naar productie — fase 2 staat klaar en wacht hierop

**Waarom:** fase 2 is gebouwd en getest (branch `v2`), maar kan pas live als het v2-schema op de productiedatabase staat. Tot die tijd draait app.verploy.com de oude versie en blijft registratie dicht. Schrijven naar productie is voor mij geblokkeerd door het beleid van deze omgeving; de hotfix van 23-09 lukte alleen met jouw expliciete akkoord in de chat.

**Wat je moet doen (één van de twee):**
- **A. (aanbevolen, eenmalig):** voeg drie GitHub-secrets toe aan de repo `mvdb2006-wq/verploy` (Settings → Secrets and variables → Actions → New repository secret):
  - `SUPABASE_ACCESS_TOKEN`: maken op supabase.com → Account → Access Tokens → "Generate new token"
  - `SUPABASE_DB_PASSWORD`: het databasewachtwoord van het project (Project Settings → Database; gebruik "Reset database password" als je het niet meer weet)
  - `SUPABASE_PROJECT_REF`: `awsdapsdlazppvaemrki`

  Ik schrijf de GitHub Action die bij elke push naar `main` de migraties toepast (`supabase db push`).
- **B.** Per migratie in de chat akkoord geven, zodat ik hem via de SQL Editor uitvoer.

**Daarna doe ik zelf:** `v2` mergen naar `main` (Vercel deployt), in Supabase Auth de redirect-URL `https://app.verploy.com/auth/callback` toevoegen en registratie weer aanzetten, controleren dat alles werkt, en je laten weten dat de sites opnieuw gekoppeld kunnen worden (#1).

**Ondertussen:** ik bouw fase 3 verder op `v2`; alle migraties worden lokaal op Postgres 16 getest met de RLS-testsuite.

---

## 2b. 🟡 CI en migratie-workflow activeren — kan nu

**Waarom:** de GitHub-token op je laptop mist de `workflow`-scope, dus ik kan geen bestanden in `.github/workflows/` pushen. De workflows staan klaar in `ops/github-workflows/` (CI: typecheck, lint, unit- en databasetests, build, PHP 7.4-syntax; migraties: `supabase db push` na groene CI op `main`).

**Wat je moet doen (één van de twee):**
- **A.** Geef toestemming in de chat: *"Je mag de workflows via de GitHub-website toevoegen."* Dan zet ik ze via de browser in de repo (je moet dan ingelogd zijn op github.com in de browser van de Claude-app).
- **B.** Vernieuw de token op je laptop met de scope `workflow` (GitHub → Settings → Developer settings → Personal access tokens). Daarna push ik ze zelf.

---

## 2c. 🟠 Twee omgevingsvariabelen in Vercel — samen met #2

**Waarom:** de onderhouds-cron (drempels, SSL/domein, e-mails) werkt alleen met een geheim. E-mail vanaf verploy.com kan pas na #5.

**Wat je moet doen (één van de twee):**
- **A.** Zeg: *"Je mag de omgevingsvariabelen in Vercel zetten."* Dan zet ik `CRON_SECRET` (een willekeurige waarde die ik genereer) en `NEXT_PUBLIC_APP_URL=https://app.verploy.com` zelf via de browser.
- **B.** Vercel → project → Settings → Environment Variables → voeg `CRON_SECRET` toe met een willekeurige lange waarde (minstens 32 tekens), en controleer `NEXT_PUBLIC_APP_URL = https://app.verploy.com`.

---

## 3. 🟠 Railway voor de worker — nodig om fase 4 live te zetten

**Waarom:** de worker voert de veilige updates uit (staging, tests, rollback) en neemt het monitoringonderhoud over. Hij is klaar en getest, maar moet ergens 24/7 draaien. Er bestaat nog geen Railway-project.

**Wat je moet doen:**
1. Maak een account op railway.com (inloggen met GitHub kan) en kies het Hobby-plan ($5/maand).
2. New Project → Deploy from GitHub repo → `mvdb2006-wq/verploy`. Zet bij Settings: **Root Directory** `dashboard`, **Config file** `worker/railway.json` (die gebruikt `worker/Dockerfile`).
3. Zet onder *Variables* dezelfde waarden als in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VERPLOY_ENCRYPTION_KEY` (als je die in Vercel hebt), `NEXT_PUBLIC_APP_URL=https://app.verploy.com`, en straks `RESEND_API_KEY` + `RESEND_FROM` (#5).

Of zeg: *"Je mag Railway instellen."* Dan doe ik stap 2 en 3 zelf in de browser, zodra jij in de browser van de Claude-app bent ingelogd op railway.com.

## 4. 🟠 Publiek bereikbare test-WordPress — voor het controlemoment na fase 4

**Waarom:** je wilt de drie scenario's (live / tegengehouden / teruggedraaid) zelf zien op een echte site. Mijn sandbox-WordPress is niet bereikbaar vanaf internet.

**Wat je moet doen:**
1. Maak in DirectAdmin een subdomein aan, bijvoorbeeld `test.verploy.com`, en installeer daar WordPress (Softaculous of handmatig).
2. Laat me weten dat hij klaarstaat. De Verploy-plugin en de testplugins installeer en koppel ik zelf via de browser zodra jij bent ingelogd.

---

## 5. 🟡 Resend voor e-mail — nodig in fase 3

**Waarom:** waarschuwingen en rapporten moeten per e-mail verstuurd worden vanaf `@verploy.com`.

**Wat je moet doen:**
1. Maak een account op resend.com → Domains → Add domain → `verploy.com`.
2. Zet de DNS-records die Resend toont (SPF/DKIM, 3–4 records) bij Vimexx. Ik kan je stap voor stap begeleiden als je dat scherm open hebt.
3. API Keys → Create → zet hem in Vercel als `RESEND_API_KEY`, en `RESEND_FROM` als `Verploy <meldingen@verploy.com>`.

**Ondertussen:** e-mails worden gebouwd en getest met een lokale mock die de exacte Resend-API-aanroep vastlegt (fase 3: 3 e-mailscenario's groen). Zonder sleutel blijven meldingen in-app zichtbaar en wachten de e-mails in de wachtrij.

---

## 6. 🟡 Anthropic API-key — voor de AI-verfijning van de diagnose (fase 5 is klaar)

**Waarom:** de diagnose werkt nu al regelgebaseerd (schuldige plugin, soort fout, oplossing, in 5 talen). Met een sleutel verfijnt Claude die uitleg, zeker bij fouten die niet in een standaardpatroon vallen.

**Wat je moet doen:** maak op console.anthropic.com een API-key aan (Settings → API Keys) en zet hem bij de worker in Railway als `ANTHROPIC_API_KEY` (na #3). Of zeg *"Je mag de Anthropic-sleutel in Railway zetten"*, dan doe ik dat in de browser zodra jij bent ingelogd.

**Ondertussen:** de aanroep is getest met nagebootste API-antwoorden in het gedocumenteerde formaat, inclusief weigering, afgebroken antwoord, fout en ongeldige JSON. Een echte aanroep is pas mogelijk met de sleutel; de eerste echte run controleer ik zelf.

## 7. 🟡 Stripe — fase 7 is klaar, wacht op de sleutel

**Wat je moet doen:**
1. Maak een Stripe-account (of gebruik je bestaande) en blijf in **testmodus**.
2. Developers → API keys → kopieer de **Secret key** (`sk_test_…`) en zet hem in Vercel als `STRIPE_SECRET_KEY`. Of zeg *"Je mag Stripe instellen"*, dan doe ik dat in de browser zodra je bent ingelogd.
3. Daarna draai ik zelf `scripts/stripe-setup.mjs`. Dat maakt het product, de 4 prijzen (uit de plans-tabel), het klantportaal en de webhook aan, en ik zet `STRIPE_WEBHOOK_SECRET` en `STRIPE_PORTAL_CONFIGURATION` in Vercel.

**Keuze voor jou (met je boekhouder):** btw. De prijzen zijn nu exclusief btw en Stripe rekent zelf nog geen btw. Voor verkoop in de EU is Stripe Tax de eenvoudigste route (Settings → Tax → activeren, NL-registratie invullen). Zeg welke kant je op wilt, dan zet ik het aan: de code is er al op voorbereid.

**Live gaan (later):** dezelfde stappen met de live-sleutel, na je akkoord.

## 8. ⚪ WordPress.org-publicatie — plugin is klaar (Plugin Check: geen fouten)

**Wat je moet doen:**
1. Maak een account op wordpress.org, of gebruik je bestaande.
2. Zorg voor een openbare **privacyverklaring** en **gebruiksvoorwaarden** (bijvoorbeeld verploy.com/privacy en verploy.com/terms). WordPress.org eist links naar de voorwaarden van een externe dienst in de readme. De marketingsite staat bewust nog niet online; twee losse pagina's zijn genoeg.
3. Daarna dien ik de plugin in via wordpress.org/plugins/developers/add (met jouw account in de browser), met de wporg-zip en een toelichting op de staging/rollback-onderdelen. De review duurt meestal 1–4 weken.

## 9. ⚪ Ter info (geen actie nodig voor de bouw)

- **Connector 1.3.0-incident (23-09):** 1.3.0 gaf een fatale fout op elke pagina. 1.3.1 lost het op en staat op de downloadlink; jij hebt de plugin van emhostingendesign.nl verwijderd en de site draait weer. Zodra connector 2.0 klaar is (fase 2), koppelen we de site opnieuw via een koppelcode.
