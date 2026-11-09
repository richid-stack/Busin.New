import http from 'node:http'
import net from 'node:net'
import dns from 'node:dns/promises'
import type { Duplex } from 'node:stream'
import { addressKind } from './addresses'

/**
 * A tiny proxy that the Bridge's browser sends every request through while it looks at a page. A check done before
 * the browser connects can be fooled: a name can point somewhere public when it is checked and somewhere private a
 * moment later, a page can answer with a redirect to the router, and web sockets and sub-requests never pass the
 * checks done on the first address. Here the name is resolved once, every address is judged, and the connection is
 * made to the address that was judged, so what was checked is what is reached. Every redirect arrives as a new
 * request and is judged again.
 *
 * Pages on this computer (localhost) are reachable only when the page asked for is itself on this computer.
 * Only reading is allowed: a page cannot post to, change or delete anything.
 */
export interface GuardOptions {
  allowLoopback: boolean
  /** All addresses a name points to. Replaceable in tests. */
  lookup?: (host: string) => Promise<string[]>
  /** Replaces the built-in rule. Only for tests, where every address is on this computer. */
  addressAllowed?: (ip: string, port: number) => boolean
}
export interface Guard { url: string, /** Hosts that were refused, as host:port. */ blocked: string[], close(): Promise<void> }

const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS'])
const defaultLookup = async (host: string) => (await dns.lookup(host, { all: true })).map(a => a.address)

export async function startGuard(options: GuardOptions): Promise<Guard> {
  const lookup = options.lookup ?? defaultLookup
  const blocked: string[] = []
  const sockets = new Set<Duplex>()
  const track = (s: Duplex) => { sockets.add(s); s.once('close', () => sockets.delete(s)) }
  const allowed = (ip: string, port: number) => {
    if (options.addressAllowed) return options.addressAllowed(ip, port)
    const kind = addressKind(ip)
    return kind === 'public' || (kind === 'loopback' && options.allowLoopback)
  }
  /** The one address to connect to, or null when any address the name points to is not allowed. */
  async function pick(rawHost: string, port: number): Promise<string | null> {
    const host = rawHost.replace(/^\[|\]$/g, '')
    let addresses: string[]
    try { addresses = net.isIP(host) ? [host] : /^localhost$/i.test(host) || /\.localhost$/i.test(host) ? ['127.0.0.1'] : await lookup(host) } catch { return null }
    const ok = addresses.length > 0 && addresses.every(a => allowed(a, port))
    if (!ok) { if (blocked.length < 50) blocked.push(`${host}:${port}`); return null }
    return addresses[0]!
  }

  const server = http.createServer(async (req, res) => {
    let url: URL
    try { url = new URL(req.url ?? '') } catch { res.writeHead(400).end(); return }
    if (url.protocol !== 'http:') { res.writeHead(400).end(); return }
    const method = (req.method ?? 'GET').toUpperCase()
    if (!READ_ONLY.has(method)) { res.writeHead(405, { allow: 'GET, HEAD, OPTIONS' }).end(); return }
    const port = Number(url.port || 80)
    const ip = await pick(url.hostname, port)
    if (!ip) { res.writeHead(403, { 'x-openlobs-guard': 'blocked' }).end(); return }
    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: url.host }
    delete headers['proxy-connection']
    delete headers['proxy-authorization']
    const upstream = http.request({ host: ip, port, method, path: `${url.pathname}${url.search}`, headers, setHost: false }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers)
      r.pipe(res)
    })
    upstream.setTimeout(30_000, () => upstream.destroy())
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    res.on('close', () => upstream.destroy())
    upstream.end()
  })

  // HTTPS and web sockets arrive as CONNECT: a tunnel the browser fills itself, opened only to a judged address.
  server.on('connect', async (req, client: Duplex, head: Buffer) => {
    track(client)
    const target = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? '')
    const port = target ? Number(target[2]) : 0
    const ip = target && port > 0 && port < 65536 ? await pick(target[1]!, port) : null
    if (!ip) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
    const upstream = net.connect(port, ip)
    track(upstream)
    upstream.setTimeout(60_000, () => upstream.destroy())
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    const drop = () => { upstream.destroy(); client.destroy() }
    upstream.on('error', drop)
    client.on('error', drop)
  })
  server.on('connection', track)

  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  const port = (server.address() as net.AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    blocked,
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy()
      server.close(() => resolve())
      server.closeAllConnections?.()
    })
  }
}
