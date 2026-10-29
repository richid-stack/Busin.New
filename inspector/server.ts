import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { InspectError, captureScreenshot } from '../server/services/inspect/browser'
import { LocalBrowserService, answerWorker, bearerMatches } from '../server/services/browser/service'

/**
 * The screenshot worker: a tiny HTTP service that takes a picture of a public web page for OpenLobs.
 * It holds no secrets besides the shared one, and should run under a service account with no roles.
 * POST /screenshot  { url, width?, height?, fullPage?, waitMs?, colorScheme? }  ->  { imageBase64, width, height, url, title }
 * POST /browser/{check,act,status,frame,takeover,handback,input,close}  a live browser session for browser use (see server/services/browser).
 */
const SECRET = process.env.INSPECTOR_SECRET || ''
const PORT = Number(process.env.PORT || 8080)
// Live browser sessions for browser use: a few at once, each in its own isolated context.
const browsers = new LocalBrowserService({ maxSessions: Math.max(1, Math.min(6, Number(process.env.BROWSER_MAX_SESSIONS) || 2)) })
process.on('SIGTERM', () => { void browsers.manager.shutdown().finally(() => process.exit(0)) })
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
    if (req.method === 'POST' && req.url?.startsWith('/browser/')) {
      if (!bearerMatches(req.headers.authorization, SECRET)) return send(res, 401, { error: 'Unauthorized' })
      let body: unknown
      try { body = JSON.parse(await readBody(req, 20_000)) } catch { return send(res, 400, { error: 'That request could not be read.', code: 'bad_input' }) }
      const reply = await answerWorker(browsers, req.url.slice('/browser/'.length), body)
      if (reply.image) {
        const f = reply.image
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Width': String(f.width), 'X-Height': String(f.height), 'X-Url': encodeURIComponent(f.url), 'X-Title': encodeURIComponent(f.title), 'X-Control': f.control })
        return void res.end(f.bytes)
      }
      return send(res, reply.status, reply.json)
    }
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
