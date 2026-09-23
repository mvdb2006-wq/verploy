import { NextResponse } from 'next/server'

const PLUGIN_VERSION  = '1.3.0'
const PLUGIN_DOWNLOAD = `https://app.verploy.com/api/v1/plugin/download`
const PLUGIN_DETAILS  = 'https://verploy.com/docs/connector'

// Cache for 1 hour on Vercel Edge
export const revalidate = 3600

export async function GET() {
  return NextResponse.json({
    version:      PLUGIN_VERSION,
    download_url: PLUGIN_DOWNLOAD,
    details_url:  PLUGIN_DETAILS,
    tested_up_to: '6.7',
    requires:     '5.8',
    requires_php: '7.4',
    slug:         'verploy-connector',
    name:         'Verploy Connector',
    author:       'Verploy',
  })
}
