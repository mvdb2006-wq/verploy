import { NextResponse } from 'next/server'
import { CONNECTOR_RELEASE } from '@/lib/connector/release'

export const dynamic = 'force-dynamic'

/** Update-informatie voor de zelf-updater in de direct-build van de plugin. */
export async function GET() {
  return NextResponse.json({
    version: CONNECTOR_RELEASE.version,
    download_url: 'https://app.verploy.com/api/v1/plugin/download',
    details_url: 'https://app.verploy.com',
    tested_up_to: CONNECTOR_RELEASE.testedWp,
    requires: CONNECTOR_RELEASE.requiresWp,
    requires_php: CONNECTOR_RELEASE.requiresPhp,
    slug: 'verploy-connector',
    name: 'Verploy Connector',
    author: 'Verploy',
  }, { headers: { 'Cache-Control': 'no-store' } })
}
