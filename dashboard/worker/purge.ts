/**
 * Bestanden in Storage opruimen na het verwijderen van een run, rapport, site of bureau
 * (wachtrij storage_purges, gevuld door triggers in de database). Zo blijven er na "site verwijderen" of
 * "account verwijderen" geen screenshots of rapporten achter.
 */
import type { Admin } from './run'

type Bucket = 'run-artifacts' | 'reports' | 'branding'

/** Alle bestanden onder een map (Storage geeft per niveau; mappen hebben geen id). */
async function listAll(admin: Admin, bucket: Bucket, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 5) return []
  const out: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset })
    if (error) throw error
    for (const e of data ?? []) {
      const path = `${prefix}/${e.name}`
      if (e.id) out.push(path)
      else out.push(...await listAll(admin, bucket, path, depth + 1))
    }
    if (!data || data.length < 1000) break
  }
  return out
}

export interface PurgeResult { prefixes: number; files: number; failed: number }

export async function purgeStorage(admin: Admin, limit = 50): Promise<PurgeResult> {
  const { data: queue, error } = await admin.from('storage_purges').select('id, bucket, prefix, attempts')
    .lt('attempts', 5).order('id').limit(limit)
  if (error) throw error
  const out: PurgeResult = { prefixes: 0, files: 0, failed: 0 }
  for (const item of queue ?? []) {
    try {
      const bucket = item.bucket as Bucket
      // Een los bestand (rapport-PDF) of een map (run, bureau).
      const files = /\.[a-z0-9]{2,5}$/i.test(item.prefix) ? [item.prefix] : await listAll(admin, bucket, item.prefix)
      for (let i = 0; i < files.length; i += 100) {
        const { error: rErr } = await admin.storage.from(bucket).remove(files.slice(i, i + 100))
        if (rErr) throw rErr
      }
      const { error: dErr } = await admin.from('storage_purges').delete().eq('id', item.id)
      if (dErr) throw dErr
      out.prefixes++
      out.files += files.length
    } catch {
      out.failed++
      await admin.from('storage_purges').update({ attempts: item.attempts + 1 }).eq('id', item.id)
    }
  }
  return out
}
