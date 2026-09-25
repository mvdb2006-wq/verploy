/**
 * (WordPress schrijft het logboek in de taal van de site: Engels én Nederlands worden herkend.)
 *
 * Waarom een update niet lukte, uit het logboek van WordPress (de upgrader) dat de connector meestuurt.
 * Verploy vertaalt de melding naar een oorzaak in gewone taal met wat je eraan kunt doen, en bewaart de
 * letterlijke melding (zonder geheimen) voor wie precies wil zien wat WordPress zei. Puur: geen I/O.
 */
export type FailureKind =
  | 'license' | 'no_package' | 'download' | 'permissions' | 'folder_exists' | 'bad_package' | 'requirements' | 'disk_space' | 'unknown'

export interface Failure { kind: FailureKind; message: string | null }

const RULES: [FailureKind, RegExp][] = [
  ['disk_space', /disk space|no space left|schijfruimte/i],
  ['requirements', /requires (at least )?(php|wordpress)|minimum (php|wordpress)|php version .* (required|needed)|vereist (php|wordpress)/i],
  ['license', /licen[sc]e|purchase code|aankoopcode|activate (the|your) (plugin|product|theme)|not (been )?activated|registrat|subscription|abonnement|\b(401|403)\b|unauthori[sz]ed|forbidden/i],
  ['no_package', /update package not available|package not available|no package|geen (update)?pakket|pakket niet beschikbaar|not found|niet gevonden|\b404\b|invalid url|url (is )?ongeldig|opgegeven url/i],
  ['permissions', /could not (create|copy|remove|move|delete)|unable to (create|copy|remove|move|delete)|not writable|permission denied|(kon|kan) .*niet (aanmaken|kopiëren|verwijderen|verplaatsen)|niet beschrijfbaar|geen toestemming/i],
  ['folder_exists', /destination folder already exists|doelmap bestaat al/i],
  ['bad_package', /incompatible archive|pclzip|not a valid zip|no valid plugins were found|no valid themes|the package could not be installed|incompatibel archief|ongeldig (zip|archief|pakket)|geen geldige (plugin|thema)/i],
  ['download', /download failed|could not resolve|timed out|curl error|ssl|http error|connection (refused|reset)|download(en)? mislukt/i],
]

/** Geheimen uit een melding halen: querystrings (licentiesleutels in download-URL's) en lange tokens. */
export function redact(line: string): string {
  return line
    .replace(/(https?:\/\/[^\s?#"'<>]+)\?[^\s"'<>]*/gi, '$1?…')
    .replace(/\b[a-f0-9]{24,}\b/gi, '…')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '…')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '…')
}

/** De meest zeggende regel: de laatste foutregel, anders de laatste regel. */
function keyLine(lines: string[]): string | null {
  const errors = lines.filter(l => /^error:|error|fout|failed|mislukt|could not|unable/i.test(l))
  const pick = errors.at(-1) ?? lines.at(-1)
  if (!pick) return null
  return redact(pick.replace(/^(error|fout):\s*/i, '')).slice(0, 300)
}

export function explainFailure(log: string | null | undefined): Failure {
  const lines = String(log ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return { kind: 'unknown', message: null }
  const text = lines.join('\n')
  const kind = RULES.find(([, re]) => re.test(text))?.[0] ?? 'unknown'
  return { kind, message: keyLine(lines) }
}

/**
 * De oorzaak om te tonen: opnieuw afgeleid uit de bewaarde melding (zodat betere herkenning ook voor
 * oudere runs geldt), anders wat de worker destijds vastlegde.
 */
export function failureKind(f: { kind: string; message: string | null }): FailureKind {
  const again = f.message ? explainFailure(f.message).kind : 'unknown'
  return again !== 'unknown' ? again : (RULES.some(([k]) => k === f.kind) ? f.kind as FailureKind : 'unknown')
}
