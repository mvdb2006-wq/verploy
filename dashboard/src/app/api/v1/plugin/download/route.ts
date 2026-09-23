import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { CONNECTOR_RELEASE } from '@/lib/connector/release'

export const dynamic = 'force-dynamic'

/** Levert de actuele connector-ZIP met expliciete binaire headers (geen CDN-compressie). */
export async function GET() {
  const file = await readFile(path.join(process.cwd(), 'public', 'downloads', CONNECTOR_RELEASE.file))
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${CONNECTOR_RELEASE.file}"`,
      'Content-Length': String(file.length),
      'Cache-Control': 'no-store',
      'Content-Encoding': 'identity',
    },
  })
}
