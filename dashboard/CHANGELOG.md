# Verploy app — versies

Bij elke uitrol gaat het versienummer omhoog (semver): patch voor een fix, minor voor iets nieuws, major
voor een breuk. De bovenste versie hier moet gelijk zijn aan `version` in package.json (de test
`src/lib/version.test.ts` bewaakt dat). In de app staat onderin de zijbalk "Verploy x.y.z · <build>".

## 2.6.0 — 26-09-2026
- Jouw rol zichtbaar onder Mijn account en op Team; de eigenaar gemarkeerd in de ledenlijst.
- Abonnement: één status (gratis, proef of betaald plan); "Huidig" alleen bij een lopend Stripe-abonnement.
- Betalen: EM Hosting & Design is zelf verkoper (Managed Payments uit), btw via Stripe Tax.
- Alarm voor de beheerder (worker, vastgelopen runs, heartbeats, Stripe-webhook, mislukte auth-mails).
- Melding naar het team bij elke nieuwe registratie.
- Bureau en account verwijderen; bestanden in Storage worden opgeruimd (ook na site verwijderen).

## 2.5.0 — 26-09-2026
- Connector 2.5.4, automatische uitrol van nieuwe connectorversies, opslag van screenshots als JPEG,
  rustige sites aantikken, uitleg bij mislukte updates.
