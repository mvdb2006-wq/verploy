import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

// GET /api/v1/plugin/download
// Serves the Verploy Connector ZIP with explicit binary headers,
// preventing Vercel CDN from applying content-encoding that would
// corrupt the file for PHP's PCLZIP.

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const zipPath = join(process.cwd(), 'public', 'downloads', 'verploy-connector-1.3.1.zip')
    const file    = readFileSync(zipPath)

    return new NextResponse(file, {
      status: 200,
      headers: {
        'Content-Type':        'application/zip',
        'Content-Disposition': 'attachment; filename="verploy-connector-1.3.1.zip"',
        'Content-Length':      String(file.length),
        'Cache-Control':       'no-store',
        'Content-Encoding':    'identity',   // ← voorkomt gzip/br compressie door CDN
      },
    })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
