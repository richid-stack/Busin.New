import http from 'node:http'
import net from 'node:net'
import { parseSafeUrl, safeLookup } from './netSafety'

/**
 * A small forward proxy that a real browser is pointed at, so that EVERY connection it makes (the page, its images and
 * scripts, redirects, WebSockets) passes one check: a public website on a standard port. A redirect from a public page to
 * a private address is the case a per-request check cannot see, because the browser follows it by itself; here it is
 * simply another connection, refused.
 *
 * The address is looked up and checked at the moment of connecting, and the connection goes to the address that was
 * checked, so a name that changes its answer between the check and the connection gains nothing.
 */
export interface GuardProxy {
  /** For the browser's proxy setting. */
  server: string
  /** Use with `server` so even localhost goes through the proxy (and is refused there). */
  bypass: string
  /** How many connections were refused. */
  readonly refused: number
  close(): Promise<void>
}

/** On every refusal the proxy answers with this header, so a browser session can tell a blocked page from a page that says 403. */
export const GUARD_HEADER = 'x-openlobs-guard'

const isLoopback = (host: string) => /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i.test(host)
const HOP = /^(proxy-connection|proxy-authorization|connection|keep-alive|te|trailer|transfer-encoding|upgrade)$/i

export async function startGuardProxy(options: { allowLocal?: boolean, idleMs?: number } = {}): Promise<GuardProxy> {
  const idleMs = options.idleMs ?? 120_000
  let refused = 0

  /** Is this host and port somewhere the browser may go? */
  const check = (host: string, port: number): { ok: boolean, local: boolean } => {
    const bare = host.replace(/^\[|\]$/g, '')
    if (options.allowLocal && isLoopback(bare)) return { ok: true, local: true }
    try {
      const url = new URL(`https://${bare.includes(':') ? `[${bare}]` : bare}:${port}/`)
      parseSafeUrl(url.toString())
      return { ok: true, local: false }
    } catch {
      return { ok: false, local: false }
    }
  }

  const server = http.createServer((req, res) => {
    let target: URL
    try { target = new URL(req.url ?? '') } catch { res.writeHead(400).end(); return }
    const port = Number(target.port || 80)
    const verdict = target.protocol === 'http:' ? check(target.hostname, port) : { ok: false, local: false }
    if (!verdict.ok) { refused++; res.writeHead(403, { 'Content-Type': 'text/plain', [GUARD_HEADER]: 'blocked' }).end('Blocked: not a public website.'); return }
    const headers: http.OutgoingHttpHeaders = {}
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.test(k)) headers[k] = v
    const out = http.request({ host: target.hostname.replace(/^\[|\]$/g, ''), port, path: target.pathname + target.search, method: req.method, headers, lookup: verdict.local ? undefined : safeLookup, timeout: idleMs }, (upstream) => {
      const h: http.OutgoingHttpHeaders = {}
      for (const [k, v] of Object.entries(upstream.headers)) if (!HOP.test(k)) h[k] = v
      res.writeHead(upstream.statusCode ?? 502, h)
      upstream.pipe(res)
    })
    out.on('timeout', () => out.destroy())
    out.on('error', () => { if (!res.headersSent) res.writeHead(502).end(); else res.destroy() })
    res.on('close', () => out.destroy())
    req.pipe(out)
  })

  server.on('connect', (req, client: net.Socket, head) => {
    const raw = req.url ?? ''
    const cut = raw.lastIndexOf(':')
    const host = cut > 0 ? raw.slice(0, cut) : raw
    const port = Number(cut > 0 ? raw.slice(cut + 1) : 443)
    const verdict = Number.isInteger(port) ? check(host, port) : { ok: false, local: false }
    if (!verdict.ok) { refused++; client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return }
    let open = false
    const upstream = net.connect({ host: host.replace(/^\[|\]$/g, ''), port, lookup: verdict.local ? undefined : safeLookup }, () => {
      open = true
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    // Before the tunnel is up a failure is answered; after, the connection is simply dropped.
    upstream.on('error', () => {
      if (!open && client.writable) client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
      else client.destroy()
      upstream.destroy()
    })
    client.on('error', () => { upstream.destroy(); client.destroy() })
    for (const s of [upstream, client]) s.setTimeout(idleMs, () => s.destroy())
    client.on('close', () => upstream.destroy())
    upstream.on('close', () => client.destroy())
  })
  server.on('clientError', (_e, socket) => { socket.destroy() })

  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as net.AddressInfo).port
  return {
    server: `http://127.0.0.1:${port}`,
    bypass: '<-loopback>',
    get refused() { return refused },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()) })
  }
}
