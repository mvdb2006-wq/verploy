// Minimale Kong-vervanger voor lokale ontwikkeling: routeert zoals Supabase.
//   /auth/v1/*  -> GoTrue   (AUTH_PORT, standaard 9999)
//   /rest/v1/*  -> PostgREST (REST_PORT, standaard 3001)
import http from 'node:http'

const PORT = Number(process.env.GATEWAY_PORT ?? 54321)
const routes = [
  { prefix: '/auth/v1', port: Number(process.env.AUTH_PORT ?? 9999) },
  { prefix: '/rest/v1', port: Number(process.env.REST_PORT ?? 3001) },
]

http.createServer((req, res) => {
  const route = routes.find(r => req.url === r.prefix || req.url.startsWith(r.prefix + '/') || req.url.startsWith(r.prefix + '?'))
  if (!route) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"message":"no route"}'); return }
  const path = req.url.slice(route.prefix.length) || '/'
  const headers = { ...req.headers, host: `127.0.0.1:${route.port}` }
  const upstream = http.request({ host: '127.0.0.1', port: route.port, method: req.method, path, headers }, up => {
    res.writeHead(up.statusCode ?? 502, up.headers)
    up.pipe(res)
  })
  upstream.on('error', err => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: err.message })) })
  req.pipe(upstream)
}).listen(PORT, '127.0.0.1', () => console.log(`[gateway] http://127.0.0.1:${PORT}`))
