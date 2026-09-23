// Lokale stand-in voor api.resend.com: legt verstuurde e-mails vast zodat E2E-tests
// kunnen controleren wat er (in welke taal, aan wie) verstuurd wordt.
import http from 'node:http'

const port = Number(process.env.MOCK_RESEND_PORT ?? 4010)
let sent = []

http.createServer((req, res) => {
  const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.method === 'GET' && req.url === '/__sent') return reply(200, sent)
  if (req.method === 'DELETE' && req.url === '/__sent') { sent = []; return reply(200, { ok: true }) }
  if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true })
  if (req.method === 'POST' && req.url === '/emails') {
    if (!/^Bearer re_/.test(req.headers.authorization ?? '')) return reply(401, { name: 'missing_api_key', message: 'Missing API key' })
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const mail = JSON.parse(raw)
      const id = `mock_${sent.length + 1}`
      sent.push({ id, ...mail, to: [].concat(mail.to) })
      reply(200, { id })
    })
    return
  }
  reply(404, { message: 'not found' })
}).listen(port, '127.0.0.1', () => console.log(`[mock-resend] http://127.0.0.1:${port}`))
