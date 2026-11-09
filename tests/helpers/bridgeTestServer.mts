import http from 'node:http'
import { createFakeFirestore } from '../fakeFirestore'
import { ApiError, pairDevice, pollForJobs, reportJob, uploadJobFile } from '../../server/services/bridge/api'
import { createBridgeStore } from '../../server/services/bridge/store'
import { createFileStore } from '../../server/services/files/store'

/**
 * A small stand-in for OpenLobs that speaks the Bridge's real endpoints (the same logic the app uses, on an
 * in-memory database) over real HTTP, so a real Bridge program can pair with it, poll it and send it pictures.
 * Used by the tests that run the built Bridge as a separate process, and by the Windows installer check.
 */
export async function startBridgeTestServer() {
  const db = createFakeFirestore()
  const store = createBridgeStore(db as any)
  const files = createFileStore(db as any)
  const readJson = async (req: http.IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const text = Buffer.concat(chunks).toString('utf8')
    try { return text ? JSON.parse(text) : {} } catch { return {} }
  }
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://x')
    const send = (status: number, data: unknown, type = 'application/json') => { res.statusCode = status; res.setHeader('Content-Type', type); res.end(typeof data === 'string' ? data : JSON.stringify(data)) }
    try {
      if (u.pathname === '/page') return send(200, '<!doctype html><title>Installer Test Page</title><body style="background:#0b3d2e;color:#fff;font:24px sans-serif"><h1>Hello from the test page</h1><script>console.error("test console error")</script></body>', 'text/html')
      const body = req.method === 'POST' ? await readJson(req) : {}
      if (u.pathname === '/api/bridge/pair') return send(200, await pairDevice(store, body))
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      const device = await store.authenticate(token)
      if (!device) return send(401, { statusMessage: 'not connected' })
      if (u.pathname === '/api/bridge/poll') return send(200, await pollForJobs(store, device, token, body, { waitMs: 1500, checkMs: 300 }))
      if (u.pathname === '/api/bridge/disconnect') { await store.revoke(device.userId, device.id); return send(200, { success: true }) }
      let m = u.pathname.match(/^\/api\/bridge\/jobs\/([^/]+)\/result$/)
      if (m) return send(200, await reportJob(store, device, decodeURIComponent(m[1]!), body))
      m = u.pathname.match(/^\/api\/bridge\/jobs\/([^/]+)\/file$/)
      if (m) return send(200, await uploadJobFile(store, device, decodeURIComponent(m[1]!), body, i => files.save(i)))
      return send(404, {})
    } catch (e: any) {
      send(e instanceof ApiError ? e.status : 500, { statusMessage: e.message })
    }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as any).port}`
  return {
    url, store, files, db,
    stop: () => new Promise<void>(r => { server.closeAllConnections?.(); server.close(() => r()) })
  }
}

export const waitFor = async (what: string, fn: () => Promise<boolean>, ms = 30_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn().catch(() => false)) return; await new Promise(r => setTimeout(r, 300)) }
  throw new Error(`Timed out waiting for: ${what}`)
}
