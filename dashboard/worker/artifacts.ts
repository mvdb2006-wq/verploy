/**
 * Opslag van screenshots beperken (Supabase Storage, bucket run-artifacts).
 *
 * Tijdens een run zijn verliesvrije PNG's nodig (pixelvergelijking). Na afloop zijn ze alleen nog om
 * te bekijken; dan volstaat JPEG (≈5× kleiner) en is de tweede nulmeting (`-alt`) niet meer nodig.
 * Na RETAIN_DAYS dagen worden de beelden van een run helemaal opgeruimd; de uitkomst, de metingen en de
 * tijdlijn blijven bewaard.
 */
import type { Browser } from 'playwright-core'
import type { Admin } from './run'

const BUCKET = 'run-artifacts'
export const RETAIN_DAYS = Number(process.env.WORKER_ARTIFACT_DAYS ?? 60)
const JPEG_QUALITY = 0.72

/** Pad van de tweede nulmeting bij een screenshot-pad (zelfde opbouw als artifactPath in run.ts). */
export const altPath = (png: string) => png.replace(/\.png$/, '-alt.png')
export const jpgPath = (png: string) => png.replace(/\.png$/, '.jpg')

/** PNG → JPEG met de canvas van Chromium (de worker heeft die toch al; geen extra native pakket nodig). */
export async function toJpeg(browser: Browser, png: Buffer): Promise<Buffer> {
  const page = await browser.newPage()
  try {
    const b64 = await page.evaluate(async ({ data, q }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${data}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')!
      g.fillStyle = '#fff'
      g.fillRect(0, 0, c.width, c.height)
      g.drawImage(img, 0, 0)
      return c.toDataURL('image/jpeg', q).split(',')[1]!
    }, { data: png.toString('base64'), q: JPEG_QUALITY })
    return Buffer.from(b64, 'base64')
  } finally {
    await page.close().catch(() => undefined)
  }
}

interface Row { id: number; phase: string; screenshot_path: string | null; diff_path: string | null }

export interface CompactResult { runs: number; converted: number; removed: number; expired: number }

/** Zet afgeronde runs om naar JPEG en ruimt tweede nulmetingen en verlopen beelden op. */
export async function compactArtifacts(admin: Admin, browser: () => Promise<Browser>, opts: { maxRuns?: number } = {}): Promise<CompactResult> {
  const out: CompactResult = { runs: 0, converted: 0, removed: 0, expired: 0 }

  // 1. Verlopen: alle beelden weg, paden leeg (de pagina toont dan geen afbeelding meer).
  const cutoff = new Date(Date.now() - RETAIN_DAYS * 86_400_000).toISOString()
  const { data: old, error: oErr } = await admin.from('test_results')
    .select('id, phase, screenshot_path, diff_path, update_runs!inner(status, finished_at)')
    .eq('update_runs.status', 'done').lt('update_runs.finished_at', cutoff)
    .or('screenshot_path.not.is.null,diff_path.not.is.null').limit(500)
  if (oErr) throw oErr
  if (old?.length) {
    const paths = (old as unknown as Row[]).flatMap(r => [r.screenshot_path, r.diff_path, r.screenshot_path?.endsWith('.png') ? altPath(r.screenshot_path) : null])
      .filter((p): p is string => Boolean(p))
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + 100))
      if (error) throw error
    }
    const { error } = await admin.from('test_results').update({ screenshot_path: null, diff_path: null }).in('id', old.map(r => r.id))
    if (error) throw error
    out.expired = old.length
  }

  // 2. Afgeronde runs met nog PNG's: omzetten naar JPEG, tweede nulmeting weg.
  const { data: pending, error: pErr } = await admin.from('test_results')
    .select('run_id, update_runs!inner(status)')
    .eq('update_runs.status', 'done')
    .or('screenshot_path.like.%.png,diff_path.like.%.png').order('id', { ascending: false }).limit(300)   // nieuwste runs eerst
  if (pErr) throw pErr
  const runIds = [...new Set((pending ?? []).map(r => r.run_id))].slice(0, opts.maxRuns ?? 3)
  if (!runIds.length) return out
  const b = await browser()
  for (const runId of runIds) {
    const { data: rows, error } = await admin.from('test_results').select('id, phase, screenshot_path, diff_path').eq('run_id', runId)
    if (error) throw error
    const remove: string[] = []
    for (const r of (rows ?? []) as Row[]) {
      const patch: Partial<Pick<Row, 'screenshot_path' | 'diff_path'>> = {}
      for (const key of ['screenshot_path', 'diff_path'] as const) {
        const p = r[key]
        if (!p?.endsWith('.png')) continue
        const { data: blob } = await admin.storage.from(BUCKET).download(p)
        if (!blob) { patch[key] = null; continue }              // al weg: niet naar een ontbrekend bestand wijzen
        const jpg = await toJpeg(b, Buffer.from(await blob.arrayBuffer()))
        const { error: upErr } = await admin.storage.from(BUCKET).upload(jpgPath(p), jpg, { contentType: 'image/jpeg', upsert: true })
        if (upErr) throw upErr
        patch[key] = jpgPath(p)
        remove.push(p)
        out.converted++
      }
      if (r.screenshot_path?.endsWith('.png') && (r.phase === 'staging_before' || r.phase === 'production_before')) remove.push(altPath(r.screenshot_path))
      if (Object.keys(patch).length) {
        const { error: uErr } = await admin.from('test_results').update(patch).eq('id', r.id)
        if (uErr) throw uErr
      }
    }
    for (let i = 0; i < remove.length; i += 100) {
      const { error: rErr } = await admin.storage.from(BUCKET).remove(remove.slice(i, i + 100))
      if (rErr) throw rErr
    }
    out.removed += remove.length
    out.runs++
  }
  return out
}
