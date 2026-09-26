// Minimale Kong-vervanger voor lokale ontwikkeling: routeert zoals Supabase.
//   /auth/v1/*    -> GoTrue   (AUTH_PORT, standaard 9999)
//   /rest/v1/*    -> PostgREST (REST_PORT, standaard 3001)
//   /storage/v1/* -> lokale stand-in voor Supabase Storage (alleen wat Verploy gebruikt:
//                    uploaden, downloaden en verwijderen met de service role, in privé-buckets).
//                    De echte storage-api draait niet in deze omgeving; zie DECISIONS.md.
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.GATEWAY_PORT ?? 54321)
const STORAGE_DIR = process.env.STORAGE_DIR ?? '/tmp/verploy-local/storage'
const JWT_SECRET = process.env.LOCAL_JWT_SECRET ?? ''
const routes = [
  { prefix: '/auth/v1', port: Number(process.env.AUTH_PORT ?? 9999) },
  { prefix: '/rest/v1', port: Number(process.env.REST_PORT ?? 3001) },
]

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

function roleOf(req) {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const [h, p, s] = token.split('.')
  if (!h || !p || !s || !JWT_SECRET) return null
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')
  if (expected.length !== s.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null
  try { return JSON.parse(Buffer.from(p, 'base64url').toString()).role ?? null } catch { return null }
}

function safePath(bucket, key) {
  if (!/^[a-z0-9-]+$/.test(bucket) || !key || key.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return null
  return path.join(STORAGE_DIR, bucket, key)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject)
  })
}

async function storage(req, res, url) {
  // Privé-buckets: zonder service role geen toegang (net als zonder storage-policies in Supabase).
  if (roleOf(req) !== 'service_role') return json(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' })
  // Lijst (één niveau, zoals Supabase: mappen hebben id null).
  const lm = req.method === 'POST' && url.pathname.match(/^\/storage\/v1\/object\/list\/([^/]+)$/)
  if (lm) {
    const { prefix = '', limit = 100, offset = 0 } = JSON.parse((await readBody(req)).toString() || '{}')
    const dir = prefix ? safePath(lm[1], prefix.replace(/\/$/, '')) : (/^[a-z0-9-]+$/.test(lm[1]) ? path.join(STORAGE_DIR, lm[1]) : null)
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return json(res, 200, [])
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => !e.name.endsWith('.meta')).sort((a, b) => a.name.localeCompare(b.name))
    return json(res, 200, entries.slice(offset, offset + limit).map(e => ({ name: e.name, id: e.isDirectory() ? null : crypto.createHash('md5').update(path.join(dir, e.name)).digest('hex'), metadata: e.isDirectory() ? null : {} })))
  }
  const m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)(?:\/(.+))?$/)
  if (!m) return json(res, 404, { message: 'not supported by local storage stand-in' })
  const bucket = m[1]; const key = m[2] ? decodeURIComponent(m[2]) : ''
  if (req.method === 'DELETE' && !key) {
    const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || '{}')
    const removed = []
    for (const k of prefixes) { const f = safePath(bucket, k); if (f && fs.existsSync(f)) { fs.rmSync(f); fs.rmSync(f + '.meta', { force: true }); removed.push({ name: k, bucket_id: bucket }) } }
    return json(res, 200, removed)
  }
  const file = safePath(bucket, key)
  if (!file) return json(res, 400, { message: 'invalid path' })
  if (req.method === 'POST' || req.method === 'PUT') {
    const body = await readBody(req)
    if (req.method === 'POST' && fs.existsSync(file) && req.headers['x-upsert'] !== 'true') return json(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, body)
    fs.writeFileSync(file + '.meta', JSON.stringify({ contentType: req.headers['content-type'] ?? 'application/octet-stream' }))
    return json(res, 200, { Id: crypto.randomUUID(), Key: `${bucket}/${key}` })
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!fs.existsSync(file)) return json(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' })
    const meta = JSON.parse(fs.readFileSync(file + '.meta', 'utf8'))
    res.writeHead(200, { 'content-type': meta.contentType })
    return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file))
  }
  return json(res, 405, { message: 'method not allowed' })
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local')
  if (url.pathname.startsWith('/storage/v1/')) {
    storage(req, res, url).catch(err => json(res, 500, { message: err.message }))
    return
  }
  const route = routes.find(r => req.url === r.prefix || req.url.startsWith(r.prefix + '/') || req.url.startsWith(r.prefix + '?'))
  if (!route) { json(res, 404, { message: 'no route' }); return }
  const upstreamPath = req.url.slice(route.prefix.length) || '/'
  const headers = { ...req.headers, host: `127.0.0.1:${route.port}` }
  const upstream = http.request({ host: '127.0.0.1', port: route.port, method: req.method, path: upstreamPath, headers }, up => {
    res.writeHead(up.statusCode ?? 502, up.headers)
    up.pipe(res)
  })
  upstream.on('error', err => json(res, 502, { message: err.message }))
  req.pipe(upstream)
}).listen(PORT, '127.0.0.1', () => console.log(`[gateway] http://127.0.0.1:${PORT}`))
