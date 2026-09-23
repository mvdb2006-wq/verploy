# Verploy — BLOCKERS

Wat alleen Martijn kan leveren, gesorteerd op urgentie. Per item: waarom het nodig is, wat je precies moet doen, en wat ik ondertussen doe.

---

## 1. 🔴 Datalek in productie dichtzetten — NU

**Waarom:** de view `site_overview` draait met eigenaarsrechten (hij omzeilt RLS), is leesbaar voor elke ingelogde gebruiker en bevat de `api_key` van **alle** sites. Iedereen die zich op app.verploy.com registreert, kan zo de sleutels van jouw klantsites lezen en daarmee update-commando's naar die sites sturen.
**Waarom ik het niet zelf doe:** schrijven naar de productiedatabase is voor mij geblokkeerd door het veiligheidsbeleid van deze omgeving.

**Wat je moet doen (één van de twee):**
- **A.** Antwoord in de chat: *"Je mag de hotfix op productie uitvoeren."* Dan probeer ik het opnieuw met jouw expliciete akkoord.
- **B.** Supabase → project *verploy* → SQL Editor → plak dit en klik **Run**:
  ```sql
  alter view public.site_overview set (security_invoker = true);
  alter view public.latest_health_snapshots set (security_invoker = true);
  revoke all on public.site_overview from anon;
  revoke all on public.latest_health_snapshots from anon;
  ```
  Het dashboard blijft gewoon werken: leden zien via RLS nog steeds hun eigen sites.

**Ondertussen:** het nieuwe datamodel (fase 2) heeft geen views met secrets meer, en de API-keys worden vervangen door versleutelde per-site secrets.

---

## 2. 🟠 Migraties naar productie kunnen uitrollen — nodig vóór het einde van fase 2

**Waarom:** het v2-schema moet op de live database komen. Ik mag daar niet zelf schrijven (zie #1).

**Wat je moet doen (één van de twee):**
- **A. (aanbevolen, eenmalig):** voeg drie GitHub-secrets toe aan de repo `mvdb2006-wq/verploy` (Settings → Secrets and variables → Actions → New repository secret):
  - `SUPABASE_ACCESS_TOKEN`: maken op supabase.com → Account → Access Tokens → "Generate new token"
  - `SUPABASE_DB_PASSWORD`: het databasewachtwoord van het project (Project Settings → Database; gebruik "Reset database password" als je het niet meer weet)
  - `SUPABASE_PROJECT_REF`: `awsdapsdlazppvaemrki`

  Ik schrijf de GitHub Action die bij elke push naar `main` de migraties toepast (`supabase db push`).
- **B.** Per migratie in de chat akkoord geven, zodat ik hem via de SQL Editor uitvoer.

**Ondertussen:** alle migraties worden lokaal op Postgres 16 getest met de RLS-testsuite.

---

## 3. 🟠 Railway voor de worker — nodig in fase 4

**Waarom:** de worker (staging, Playwright-tests, rollback, later PDF's) moet ergens 24/7 draaien. Er bestaat nog geen Railway-project.

**Wat je moet doen:**
1. Maak een account op railway.com (inloggen met GitHub kan) en kies het Hobby-plan ($5/maand).
2. New Project → Deploy from GitHub repo → `mvdb2006-wq/verploy`, root directory `worker`.
3. Zet deze variabelen onder *Variables*: `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` (dezelfde waarden als in Vercel). De rest staat in `worker/.env.example`, en daar vertel ik je op dat moment precies welke waarden erin moeten.

**Ondertussen:** de worker draait en wordt getest in mijn sandbox tegen een echte test-WordPress.

---

## 4. 🟠 Publiek bereikbare test-WordPress — nodig voor het controlemoment na fase 4

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
3. API Keys → Create → zet hem in Vercel als `RESEND_API_KEY`.

**Ondertussen:** e-mails worden gebouwd en getest met een lokale mock die de exacte Resend-API-aanroep vastlegt.

---

## 6. 🟡 Anthropic API-key — nodig in fase 5

**Wat je moet doen:** maak op console.anthropic.com een API-key aan en zet hem in Railway als `ANTHROPIC_API_KEY`.

**Ondertussen:** de diagnoselogica wordt getest met opgenomen, echte API-antwoorden.

---

## 7. 🟡 Stripe — nodig in fase 7

**Wat je moet doen:** een Stripe-account (testmodus is genoeg om te bouwen). Zet `STRIPE_SECRET_KEY` (sk_test_…) in Vercel. Producten, prijzen en de webhook maak ik zelf aan via de API.

---

## 8. ⚪ WordPress.org-publicatie — fase 8

**Wat je moet doen:** een account op wordpress.org, daarna de plugin indienen via wordpress.org/plugins/developers/add. Ik lever de ZIP en de readme aan. De review duurt meestal 1–4 weken.

---

## 9. ⚪ Ter info (geen actie nodig voor de bouw)

- **verploy.com toont nog de DirectAdmin-placeholder.** De landingspagina bestaat alleen als Claude-artifact. Let op: die bevat verzonnen testimonials en bureaunamen ("Sarah de Vries — WebStudio Noordzee" e.d.) en de oude prijzen (€29/79/199). Publiceer hem niet zo; de app sluit qua stijl en belofte aan, maar neemt die content niet over.
- **Connector 1.3.0-incident (23-09):** 1.3.0 gaf een fatale fout op elke pagina. 1.3.1 lost het op en staat op de downloadlink; jij hebt de plugin van emhostingendesign.nl verwijderd en de site draait weer. Zodra connector 2.0 klaar is (fase 2), koppelen we de site opnieuw via een koppelcode.
