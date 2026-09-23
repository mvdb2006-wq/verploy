// Genereert de lokale anon- en service_role-JWT's (HS256) uit LOCAL_JWT_SECRET.
import crypto from 'node:crypto'
const secret = process.env.LOCAL_JWT_SECRET
if (!secret) throw new Error('LOCAL_JWT_SECRET ontbreekt')
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const sign = role => {
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64({ iss: 'supabase-local', role, iat: 1700000000, exp: 4102444800 })
  const s = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')
  return `${h}.${p}.${s}`
}
console.log(`LOCAL_ANON_KEY=${sign('anon')}`)
console.log(`LOCAL_SERVICE_ROLE_KEY=${sign('service_role')}`)
