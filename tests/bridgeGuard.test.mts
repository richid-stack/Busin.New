import http from 'node:http'
import net from 'node:net'
import { addressKind } from '../bridge/addresses'
import { startGuard } from '../bridge/guardProxy'
import { look, parseLookInput, LookError } from '../bridge/browser'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as any } return null }
const noSignal = new AbortController().signal

// ---- Every way of writing an address gets the same answer ----
const kind = (ip: string) => addressKind(ip)
for (const ip of ['192.168.1.1', '::ffff:192.168.1.1', '::ffff:c0a8:101', '0:0:0:0:0:ffff:c0a8:101', '64:ff9b::c0a8:101', '64:ff9b::192.168.1.1', '2002:c0a8:101::1', '::192.168.1.1', 'fec0::1', 'fe80::1%eth0', 'fd12::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '169.254.169.254', '100.64.0.1', '::', 'not-an-ip', '999.1.1.1']) assert(kind(ip) === 'private', `private whatever the spelling: ${ip}`)
for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) assert(kind(ip) === 'loopback', `this computer: ${ip}`)
for (const ip of ['8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:0808:0808::1']) assert(kind(ip) === 'public', `public: ${ip}`)

// ---- Two servers on this computer: A is "the public internet", B is "the router" ----
let bHits = 0, posts = 0
const B = http.createServer((req, res) => { bHits++; res.end('router') })
const A = http.createServer((req, res) => {
  if (req.method === 'POST') { posts++; res.end('posted'); return }
  if (req.url === '/redirect') { res.writeHead(302, { location: `http://127.0.0.1:${bPort}/admin` }).end(); return }
  if (req.url === '/subresource') { res.setHeader('content-type', 'text/html'); res.end(`<title>ok</title><img src="http://127.0.0.1:${bPort}/pixel.png"><script>fetch('/save',{method:'POST',body:'x'}).catch(()=>{})</script>`); return }
  res.end('page')
})
await new Promise<void>(r => B.listen(0, '127.0.0.1', r))
await new Promise<void>(r => A.listen(0, '127.0.0.1', r))
const bPort = (B.address() as net.AddressInfo).port
const aPort = (A.address() as net.AddressInfo).port
const onlyA = (_ip: string, port: number) => port === aPort

/** One request made through the guard, as the browser would make it. */
const viaGuard = (guardUrl: string, method: string, target: string) => new Promise<{ status: number, body: string }>((resolve, reject) => {
  const g = new URL(guardUrl)
  const req = http.request({ host: g.hostname, port: g.port, method, path: target, headers: { host: new URL(target).host } }, (res) => {
    let body = ''; res.on('data', d => body += d); res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
  })
  req.on('error', reject); req.end()
})
const connectVia = (guardUrl: string, target: string) => new Promise<string>((resolve) => {
  const g = new URL(guardUrl)
  const s = net.connect(Number(g.port), g.hostname, () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`))
  s.once('data', d => { resolve(String(d).split('\r\n')[0] ?? ''); s.destroy() })
  s.on('error', () => resolve('error'))
})

try {
  // ---- The guard on its own ----
  const g1 = await startGuard({ allowLoopback: true, addressAllowed: onlyA })
  assert((await viaGuard(g1.url, 'GET', `http://127.0.0.1:${aPort}/`)).body === 'page', 'an allowed address is reached')
  assert((await viaGuard(g1.url, 'GET', `http://127.0.0.1:${bPort}/`)).status === 403 && bHits === 0, 'a refused address is never connected to')
  assert((await viaGuard(g1.url, 'POST', `http://127.0.0.1:${aPort}/save`)).status === 405 && posts === 0, 'a page cannot send anything: POST is refused even to an allowed address')
  assert((await connectVia(g1.url, `127.0.0.1:${aPort}`)).includes('200'), 'a tunnel (https, web sockets) opens to an allowed address')
  assert((await connectVia(g1.url, `127.0.0.1:${bPort}`)).includes('403'), 'a tunnel to a refused address is refused')
  assert(g1.blocked.includes(`127.0.0.1:${bPort}`), 'what was refused is recorded')
  await g1.close()

  // This computer's own services are reachable only when a page on this computer was asked for.
  const gLocal = await startGuard({ allowLoopback: true })
  const gPublic = await startGuard({ allowLoopback: false })
  assert((await viaGuard(gLocal.url, 'GET', `http://127.0.0.1:${aPort}/`)).status === 200, 'a page on this computer may reach this computer')
  assert((await viaGuard(gPublic.url, 'GET', `http://127.0.0.1:${aPort}/`)).status === 403, 'a public page may not reach this computer')
  assert((await viaGuard(gPublic.url, 'GET', `http://localhost:${aPort}/`)).status === 403, 'nor by the name localhost')
  assert((await connectVia(gPublic.url, `[::1]:${aPort}`)).includes('403'), 'nor through a tunnel to ::1')
  await gLocal.close(); await gPublic.close()

  // A name is looked up once, and every address it has must be allowed (no public-then-private trick).
  let lookups = 0
  const gDns = await startGuard({ allowLoopback: false, lookup: async () => { lookups++; return ['8.8.8.8', '192.168.1.1'] } })
  assert((await viaGuard(gDns.url, 'GET', 'http://rebind.example/')).status === 403 && lookups === 1, 'a name with one private address among public ones is refused')
  await gDns.close()
  const gHex = await startGuard({ allowLoopback: false, lookup: async () => ['::ffff:c0a8:101'] })
  assert((await viaGuard(gHex.url, 'GET', 'http://mapped.example/')).status === 403, 'an IPv4-mapped router address in hex form is refused')
  await gHex.close()

  // ---- With a real browser ----
  const redirected = await rejects(() => look(parseLookInput({ url: `http://127.0.0.1:${aPort}/redirect`, width: 400, height: 300 }), noSignal, { addressAllowed: onlyA }))
  assert(redirected instanceof LookError && /private network/.test(redirected.message) && bHits === 0, 'REAL BROWSER: a page that redirects to the router is stopped before the router is reached')
  const sub = await look(parseLookInput({ url: `http://127.0.0.1:${aPort}/subresource`, width: 400, height: 300 }), noSignal, { addressAllowed: onlyA })
  assert(bHits === 0 && posts === 0, 'REAL BROWSER: a picture from the router is not fetched and a post from the page is not sent')
  assert(sub.facts.failedRequests.some(f => /private network/.test(f)) && sub.facts.failedRequests.some(f => /only reads/.test(f)), 'REAL BROWSER: both are reported as blocked')
} finally {
  A.close(); B.close()
}
console.log(process.exitCode ? 'Bridge guard tests FAILED' : 'Bridge guard tests OK')
