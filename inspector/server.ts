import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { InspectError, captureScreenshot } from '../server/services/inspect/browser'

/**
 * The screenshot worker: a tiny HTTP service that takes a picture of a public web page for OpenLobs.
 * It holds no secrets besides the shared one, and should run under a service account with no roles.
 * POST /screenshot  { url, width?, height?, fullPage?, waitMs?, colorScheme? }  ->  { imageBase64, width, height, url, title }
 */
const SECRET = process.env.INSPECTOR_SECRET || ''
const PORT = Number(process.env.PORT || 8080)
// One picture at a time: a browser is heavy, and a small instance should not be asked to run several.
let busy = false

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const send = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req: import('node:http').IncomingMessage, max = 10_000): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > max) throw new InspectError('The request is too large.')
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

if (SECRET.length < 24) {
  console.error('INSPECTOR_SECRET must be set and at least 24 characters. Refusing to start.')
  process.exit(1)
}

createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true })
    if (req.method !== 'POST' || req.url !== '/screenshot') return send(res, 404, { error: 'Not found' })
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!same(bearer, SECRET)) return send(res, 401, { error: 'Unauthorized' })
    if (busy) return send(res, 429, { error: 'Busy, try again in a moment.' })
    busy = true
    try {
      const input = JSON.parse(await readBody(req))
      const shot = await captureScreenshot({
        url: String(input.url ?? ''),
        width: input.width, height: input.height, fullPage: Boolean(input.fullPage), waitMs: input.waitMs,
        colorScheme: input.colorScheme === 'dark' ? 'dark' : 'light'
      })
      return send(res, 200, { imageBase64: Buffer.from(shot.bytes).toString('base64'), width: shot.width, height: shot.height, url: shot.url, title: shot.title })
    } finally {
      busy = false
    }
  } catch (err: any) {
    if (err instanceof InspectError) return send(res, 400, { error: err.message })
    console.error('[inspector] failed:', err?.message)
    send(res, 500, { error: 'The screenshot could not be taken.' })
  }
}).listen(PORT, () => console.log(`[inspector] listening on ${PORT}`))
