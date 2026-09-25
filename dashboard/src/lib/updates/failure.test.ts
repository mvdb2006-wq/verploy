import { describe, expect, it } from 'vitest'
import { explainFailure, redact } from './failure'

describe('explainFailure', () => {
  it('betaalde plugin zonder geactiveerde licentie (WPBakery, Envato)', () => {
    const log = 'Downloading update from <span class="code">https://support.wpbakery.com/updates/download-link?purchase_code=abcd-1234</span>&#8230;\nError: Download failed. Unauthorized'
    expect(explainFailure(log)).toEqual({ kind: 'license', message: 'Download failed. Unauthorized' })
  })
  it('WordPress kreeg geen pakket', () => {
    expect(explainFailure('Update package not available.')).toEqual({ kind: 'no_package', message: 'Update package not available.' })
    expect(explainFailure('Downloading update from http://repo/x.zip…\nError: Download failed. Not Found').kind).toBe('no_package')
  })
  it('schrijfrechten, map bestaat al, kapot zip, eisen, schijfruimte', () => {
    expect(explainFailure('Unpacking the update…\nError: Could not create directory. /wp-content/upgrade/x').kind).toBe('permissions')
    expect(explainFailure('Error: Destination folder already exists.').kind).toBe('folder_exists')
    expect(explainFailure('Error: Incompatible Archive. PCLZIP_ERR_BAD_FORMAT').kind).toBe('bad_package')
    expect(explainFailure('Error: The plugin requires PHP version 8.1 or higher.').kind).toBe('requirements')
    expect(explainFailure('Error: Could not copy file. Not enough disk space.').kind).toBe('disk_space')
    expect(explainFailure('Error: Download failed. cURL error 28: Operation timed out').kind).toBe('download')
  })
  it('Nederlandstalige sites (WordPress schrijft in de taal van de site)', () => {
    expect(explainFailure('Update downloaden van https://x/y.zip…\nFout: Update pakket niet beschikbaar.').kind).toBe('no_package')
    expect(explainFailure('Fout: Downloaden mislukt. Unauthorized').kind).toBe('license')
    expect(explainFailure('Fout: Kon map niet aanmaken.').kind).toBe('permissions')
    expect(explainFailure('Fout: Incompatibel archief.').kind).toBe('bad_package')
    expect(explainFailure('Fout: Downloaden mislukt. cURL error 28').kind).toBe('download')
  })
  it('onbekend: de letterlijke laatste regel; leeg: niets', () => {
    expect(explainFailure('Something odd happened')).toEqual({ kind: 'unknown', message: 'Something odd happened' })
    expect(explainFailure('')).toEqual({ kind: 'unknown', message: null })
    expect(explainFailure(null)).toEqual({ kind: 'unknown', message: null })
  })
  it('geen licentiesleutels of tokens in de bewaarde melding', () => {
    expect(redact('Download failed from https://x.com/dl?key=SECRET123&site=y')).toBe('Download failed from https://x.com/dl?…')
    expect(redact('token 0123456789abcdef0123456789abcdef in log')).toBe('token … in log')
    expect(explainFailure('Error: Invalid license key 6f1d2c3b-aaaa-bbbb-cccc-1234567890ab').message).toBe('Invalid license key …')
  })
})
