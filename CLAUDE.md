# Verploy — werkafspraken voor Claude

- **Versie bij elke uitrol ophogen (semver).** Voor elke merge naar `main`: `dashboard/package.json` `version`
  ophogen (patch = fix, minor = nieuw, major = breuk) en bovenaan `dashboard/CHANGELOG.md` een regel toevoegen.
  De test `dashboard/src/lib/version.test.ts` faalt als die twee niet gelijk zijn. In de app staat onderin
  "Verploy x.y.z · <build>" (build = commit van Vercel), zo is te zien dat een nieuwe versie live staat.
- Productie-uitrol en productie-databasewijzigingen alleen na "akkoord uitrol …" van Martijn.
- Beslissingen en uitleg in `DECISIONS.md`.
