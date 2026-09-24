// Lokale stand-in voor de Wordfence Intelligence v3-feed (zelfde vorm, eigen testrecords).
// Vereist een Bearer-sleutel, zoals de echte API.
import http from 'node:http'

const port = Number(process.env.MOCK_WORDFENCE_PORT ?? 4030)
const defiant = {
  notice: 'Copyright 2012-2026 Defiant Inc.',
  license: 'Defiant hereby grants you a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute this software vulnerability information.',
  license_url: 'https://www.wordfence.com/wti-community-edition-terms-and-conditions/',
}
const range = (from, fi, to, ti) => ({ [`${from} - ${to}`]: { from_version: from, from_inclusive: fi, to_version: to, to_inclusive: ti } })
const feed = {
  'e2e00000-0000-4000-8000-000000000001': {
    id: 'e2e00000-0000-4000-8000-000000000001',
    title: 'Verploy Lab Footer <= 1.0.0 - Unauthenticated Stored Cross-Site Scripting',
    software: [{ type: 'plugin', name: 'Verploy Lab — vp-lab-footer', slug: 'vp-lab-footer', affected_versions: range('*', true, '1.0.0', true),
      patched: true, patched_versions: ['1.1.0'], remediation: 'Update to version 1.1.0, or a newer patched version' }],
    informational: false, description: 'Testrecord', references: ['https://www.wordfence.com/threat-intel/vulnerabilities/id/e2e-1'],
    cwe: null, cvss: { vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:L/I:L/A:N', score: 7.2, rating: 'High' },
    cve: 'CVE-2026-99001', cve_link: 'https://www.cve.org/CVERecord?id=CVE-2026-99001', researchers: ['E2E'],
    published: '2026-09-01 10:00:00', updated: '2026-09-02 10:00:00',
    copyrights: { message: 'This record contains material that is subject to copyright', defiant,
      mitre: { notice: 'Copyright 1999-2026 The MITRE Corporation', license: 'CVE Usage: MITRE hereby grants you a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license.', license_url: 'https://www.cve.org/Legal/TermsOfUse' } },
  },
  'e2e00000-0000-4000-8000-000000000002': {
    id: 'e2e00000-0000-4000-8000-000000000002', title: 'Verploy Lab Footer <= 0.9 - Oude lek (niet van toepassing)',
    software: [{ type: 'plugin', name: 'Verploy Lab — vp-lab-footer', slug: 'vp-lab-footer', affected_versions: range('*', true, '0.9', true), patched: true, patched_versions: ['1.0.0'] }],
    informational: false, references: [], cvss: { score: 9.8, rating: 'Critical' }, cve: null,
    published: '2025-01-01 00:00:00', updated: '2025-01-01 00:00:00', copyrights: { message: 'x', defiant },
  },
  'e2e00000-0000-4000-8000-000000000003': {
    id: 'e2e00000-0000-4000-8000-000000000003', title: 'Informatief (overgeslagen)',
    software: [{ type: 'plugin', name: 'Verploy Lab — vp-lab-footer', slug: 'vp-lab-footer', affected_versions: range('*', true, '*', true), patched: false, patched_versions: [] }],
    informational: true, references: [], cvss: null, cve: null, published: '2026-01-01 00:00:00', updated: '2026-01-01 00:00:00', copyrights: null,
  },
}

http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok') }
  if (req.method === 'GET' && req.url === '/api/intelligence/v3/vulnerabilities/production') {
    if (!/^Bearer \S+/.test(req.headers.authorization ?? '')) { res.writeHead(401); return res.end('Unauthorized') }
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(feed))
  }
  res.writeHead(404); res.end('not found')
}).listen(port, '127.0.0.1', () => console.log(`[mock-wordfence] http://127.0.0.1:${port}`))
