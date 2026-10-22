import fs from 'node:fs'
import http from 'node:http'
import { createFakeFirestore } from './fakeFirestore'
import { browserLookInputSchema, browserLookResultSchema, parseJobInput } from '../server/services/bridge/model'
import { BridgeError, createBridgeStore } from '../server/services/bridge/store'
import { ApiError, pollForJobs, reportJob, uploadJobFile } from '../server/services/bridge/api'
import { bridgeProvider, chooseComputer } from '../server/services/bridge/provider'
import { createFileStore } from '../server/services/files/store'
import { InspectError } from '../server/services/inspect/browser'
import { hostAllowed, isPrivateAddress, look, parseLookInput, parseTarget, LookError } from '../bridge/browser'
import type { BrowserLike, PageLike, RouteLike } from '../bridge/browser'
import { pollOnce } from '../bridge/core'
import type { Config, Deps, Running } from '../bridge/core'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as Error } return null }

// ---- What a request may ask for ----
assert(browserLookInputSchema.safeParse({ url: 'https://example.com' }).success && browserLookInputSchema.parse({ url: 'http://localhost:5173' }).width === 1280, 'a web address is enough; the size has defaults')
for (const bad of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'ftp://example.com', 'https://user:pw@example.com', '', 'not a url', 'chrome://settings']) {
  assert(!browserLookInputSchema.safeParse({ url: bad }).success, `refused as a web address: ${bad || '(empty)'}`)
}
assert(!browserLookInputSchema.safeParse({ url: 'https://example.com', script: 'x' }).success && !browserLookInputSchema.safeParse({ url: 'https://example.com', width: 99999 }).success, 'extra fields and silly sizes are refused')
assert((() => { try { parseJobInput('browser_look', { url: 'file:///etc/passwd' }); return false } catch (e: any) { return /http/.test(e.message) } })() && Object.keys(parseJobInput('ping', { anything: 1 })).length === 0, 'job input is checked per kind')
assert(!browserLookResultSchema.safeParse({ finalUrl: 'https://x.com', width: 1, height: 1, fileId: 'abc' }).success, 'a computer cannot name its own picture in its report')

// ---- Where the Bridge may go ----
for (const ip of ['10.0.0.1', '192.168.1.1', '172.16.5.5', '172.31.255.255', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', 'not-an-ip']) {
  assert(isPrivateAddress(ip), `private or unusable: ${ip}`)
}
for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) assert(!isPrivateAddress(ip), `public: ${ip}`)
const dnsTable: Record<string, string[]> = { 'good.example': ['93.184.216.34'], 'internal.example': ['10.1.2.3'], 'mixed.example': ['93.184.216.34', '192.168.0.9'], 'rebind.example': ['127.0.0.1'] }
const resolve = async (h: string) => { if (!dnsTable[h]) throw new Error('nxdomain'); return dnsTable[h]! }
const allowedHost = (h: string) => hostAllowed(h, resolve)
assert(await allowedHost('localhost') && await allowedHost('127.0.0.1') && await allowedHost('[::1]') && await allowedHost('93.184.216.34'), 'this computer and the public internet are fine')
assert(!(await allowedHost('192.168.1.1')) && !(await allowedHost('10.0.0.5')) && !(await allowedHost('169.254.169.254')) && !(await allowedHost('[fd00::1]')), 'private-network addresses are refused')
assert(await allowedHost('good.example') && !(await allowedHost('internal.example')) && !(await allowedHost('mixed.example')) && !(await allowedHost('rebind.example')) && !(await allowedHost('nothing.example')), 'a name is judged by every address it points to; a public name pointing at a private or local one is refused')
assert([() => parseTarget('file:///x'), () => parseTarget('https://u:p@example.com'), () => parseTarget('nonsense')].every((f) => { try { f(); return false } catch (e) { return e instanceof LookError } }), 'the Bridge re-checks the address itself')
assert(parseLookInput({ url: 'https://example.com', width: 50, height: 99999, fullPage: 'yes', colorScheme: 'blue' }).width === 320 && parseLookInput({ url: 'https://example.com', height: 99999 }).height === 1600 && !parseLookInput({ url: 'https://example.com', fullPage: 'yes' }).fullPage, 'sizes are clamped and odd values fall back')

// ---- A pretend browser ----
function fakeBrowser(script: (page: { handlers: Record<string, ((a: any) => void)[]>, gotos: string[] }, route: (url: string) => Promise<'continued' | 'aborted'>) => Promise<{ status?: number, finalUrl?: string }>, opts: { image?: (q: number) => Uint8Array, closed?: { n: number } } = {}): () => Promise<BrowserLike> {
  return async () => {
    let handler: ((r: RouteLike) => Promise<void>) | null = null
    const handlers: Record<string, ((a: any) => void)[]> = {}
    const gotos: string[] = []
    let currentUrl = 'about:blank'
    const page: PageLike = {
      on: (e, h) => { (handlers[e] ??= []).push(h) },
      goto: async (url) => {
        gotos.push(url)
        const r = await script({ handlers, gotos }, async (u) => { let out: 'continued' | 'aborted' = 'continued'; await handler!({ request: () => ({ url: () => u }), continue: async () => { out = 'continued' }, abort: async () => { out = 'aborted' } }); return out })
        currentUrl = r.finalUrl ?? url
        return { status: () => r.status ?? 200 }
      },
      title: async () => 'A page',
      url: () => currentUrl,
      waitForTimeout: async () => {},
      evaluate: async () => 2400 as any,
      screenshot: async (o: any) => (opts.image ? opts.image(o.quality ?? 72) : new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]))
    }
    return { newContext: async () => ({ newPage: async () => page, route: async (_p, h) => { handler = h }, close: async () => {} }), close: async () => { if (opts.closed) opts.closed.n++ } }
  }
}
const noSignal = new AbortController().signal
const input = parseLookInput({ url: 'http://localhost:5173/' })

{
  const closed = { n: 0 }
  const out = await look(input, noSignal, { resolve, launch: fakeBrowser(async (p, route) => {
    assert(await route('http://localhost:5173/app.js') === 'continued' && await route('data:image/png;base64,AAAA') === 'continued' && await route('https://good.example/lib.js') === 'continued', 'the page may load its own files and public ones')
    assert(await route('http://192.168.1.1/admin') === 'aborted' && await route('http://internal.example/x') === 'aborted' && await route('file:///C:/secret.txt') === 'aborted' && await route('ftp://good.example/x') === 'aborted', 'a page cannot make the browser reach a private network or a local file')
    p.handlers.console![0]!({ type: () => 'error', text: () => 'Uncaught TypeError: x is undefined' })
    p.handlers.console![0]!({ type: () => 'log', text: () => 'just chatting' })
    p.handlers.pageerror![0]!(new Error('boom'))
    p.handlers.response![0]!({ status: () => 404, url: () => 'http://localhost:5173/missing.png' })
    p.handlers.response![0]!({ status: () => 200, url: () => 'http://localhost:5173/ok.png' })
    return { status: 200 }
  }, { closed }) })
  assert(out.mediaType === 'image/jpeg' && out.image[0] === 0xFF && out.facts.title === 'A page' && out.facts.status === 200, 'a look returns a picture and the basics')
  assert(out.facts.consoleErrors.length === 2 && out.facts.consoleErrors.some(e => /TypeError/.test(e)) && out.facts.consoleErrors.some(e => /boom/.test(e)) && out.facts.failedRequests.join().includes('404') && !out.facts.failedRequests.join().includes('ok.png'), 'page errors and failed loads are reported, ordinary logs are not')
  assert(closed.n === 1, 'the browser is closed afterwards')
}
assert((await rejects(() => look(parseLookInput({ url: 'http://192.168.1.1/' }), noSignal, { resolve, launch: fakeBrowser(async () => ({})) }))) instanceof LookError, 'a private-network page is refused before any browser starts')
{
  const closed = { n: 0 }
  const e = await rejects(() => look(input, noSignal, { resolve, launch: fakeBrowser(async () => ({ finalUrl: 'http://192.168.1.1/login' }), { closed }) }))
  assert(e instanceof LookError && /private network/.test(e.message) && closed.n === 1, 'a redirect to a private address stops the look, and the browser still closes')
}
{
  const sizes: number[] = []
  const out = await look(input, noSignal, { resolve, launch: fakeBrowser(async () => ({}), { image: (q) => { sizes.push(q); return new Uint8Array(q > 50 ? 900_000 : 100_000).fill(1) } }) })
  assert(out.image.length === 100_000 && sizes.join() === '72,55,40', 'a picture that is too big is retried at lower quality until it fits')
  const e = await rejects(() => look(input, noSignal, { resolve, launch: fakeBrowser(async () => ({}), { image: () => new Uint8Array(900_000) }) }))
  assert(e instanceof LookError && /too large/.test(e.message), 'a picture that never fits fails with a clear message')
}
{
  const c = new AbortController(); c.abort()
  assert((await rejects(() => look(input, c.signal, { resolve, launch: fakeBrowser(async () => ({})) }))) instanceof LookError, 'a cancelled look does not start')
  const full = await look(parseLookInput({ url: 'http://localhost:1/', fullPage: true, height: 800 }), noSignal, { resolve, launch: fakeBrowser(async () => ({})) })
  assert(full.facts.height === 2400, 'a full-page look reports the taller picture')
}

// ---- The server side, with a real store and the real upload rules ----
let clock = new Date('2026-10-22T10:00:00Z')
const db = createFakeFirestore()
const store = createBridgeStore(db as any, { now: () => clock })
const files = createFileStore(db as any, () => clock)
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from('fake jpeg body')])
const b64 = (b: Buffer) => b.toString('base64')
const pairNew = async (user: string, name: string) => { const p = await store.createPairing(user); const r = await store.redeemPairing(p.code, { name, platform: 'windows', version: '0.2.0' }); return { ...r, device: (await store.authenticate(r.token))! } }
const alice = await pairNew('alice', 'Desk')
const bob = await pairNew('bob', 'Bob PC')

assert(((await rejects(() => store.enqueue('alice', alice.deviceId, 'browser_look', { url: 'https://example.com' }))) as BridgeError)?.message.includes('allow browser'), 'a computer that has not allowed browser looks cannot be asked, and is told how to allow it')
await store.touch(alice.device, { capabilities: ['ping', 'browser_look'] })
const allowed = await store.getDevice('alice', alice.deviceId)
assert(allowed.capabilities.includes('browser_look'), 'the computer reports what its owner allowed')
assert((await rejects(() => store.enqueue('alice', alice.deviceId, 'browser_look', { url: 'file:///etc/passwd' }))) instanceof BridgeError, 'a bad address is refused when the job is made')
const job = await store.enqueue('alice', alice.deviceId, 'browser_look', { url: 'http://localhost:5173' })
assert((job.input as any).width === 1280 && (job.input as any).colorScheme === 'light', 'the job is stored with its defaults filled in')
await store.claimJobs(alice.deviceId)

const saveFile = (i: { userId: string, name: string, mime: string, bytes: Uint8Array }) => files.save(i)
const goodUp = { mediaType: 'image/jpeg', imageBase64: b64(JPEG) }
const bobDev = bob.device
assert((await rejects(() => uploadJobFile(store, bobDev, job.id, goodUp, saveFile))) instanceof ApiError && !db.raw('generated_files').size, "another computer cannot upload to this job, and nothing is stored")
assert((await rejects(() => uploadJobFile(store, alice.device, job.id, { mediaType: 'image/jpeg', imageBase64: b64(Buffer.from('<html>not a picture</html>')) }, saveFile)))?.message.includes('not a real picture') && !db.raw('generated_files').size, 'a file that is not really a JPEG is refused, whatever it says it is')
assert((await rejects(() => uploadJobFile(store, alice.device, job.id, { mediaType: 'image/png', imageBase64: b64(JPEG) }, saveFile))) instanceof ApiError, 'a JPEG labelled as PNG is refused')
assert((await rejects(() => uploadJobFile(store, alice.device, job.id, { mediaType: 'image/jpeg', imageBase64: b64(Buffer.concat([JPEG, Buffer.alloc(700_000)])) }, saveFile)))?.message.includes('too large') && !db.raw('generated_files').size, 'a picture over the size limit is refused')
assert((await rejects(() => uploadJobFile(store, alice.device, job.id, { mediaType: 'image/jpeg', imageBase64: b64(JPEG), extra: 1 }, saveFile))) instanceof ApiError, 'unexpected fields are refused')
// No result before a picture
const early = await store.enqueue('alice', alice.deviceId, 'browser_look', { url: 'https://example.com' }); await store.claimJobs(alice.deviceId)
const facts = { title: 'T', finalUrl: 'https://example.com/', status: 200, width: 1280, height: 800, consoleErrors: [], failedRequests: [] }
assert((await store.reportResult(alice.deviceId, early.id, { ok: true, result: facts })).status === 'failed', 'a look that reports success without sending a picture is a failure')
const up = await uploadJobFile(store, alice.device, job.id, goodUp, saveFile)
const stored = db.raw('generated_files').get(up.fileId)
assert(stored?.userId === 'alice' && stored.mime === 'image/jpeg' && stored.name === 'page-look.jpg', 'the picture is kept under the person who owns the job')
assert((await rejects(() => uploadJobFile(store, alice.device, job.id, goodUp, saveFile)))?.message.includes('already has its picture'), 'a job gets one picture')
assert((await store.reportResult(alice.deviceId, job.id, { ok: true, result: { ...facts, fileId: 'someone-elses-file' } })).status === 'failed', "a report that names a file is rejected, so a computer cannot point a job at another person's picture")
const j2 = await store.enqueue('alice', alice.deviceId, 'browser_look', { url: 'http://localhost:5173' }); await store.claimJobs(alice.deviceId)
const up2 = await uploadJobFile(store, alice.device, j2.id, goodUp, saveFile)
const done = await store.reportResult(alice.deviceId, j2.id, { ok: true, result: facts })
assert(done.status === 'done' && (done.result as any).fileId === up2.fileId && (done.result as any).title === 'T', 'the finished job carries the picture the server saved')
assert((await rejects(() => uploadJobFile(store, alice.device, j2.id, goodUp, saveFile))) instanceof ApiError, 'no more pictures once the job is done')
assert((await store.reportResult(alice.deviceId, (await (async () => { const j = await store.enqueue('alice', alice.deviceId, 'browser_look', { url: 'https://example.com' }); await store.claimJobs(alice.deviceId); await uploadJobFile(store, alice.device, j.id, goodUp, saveFile); return j })()).id, { ok: true, result: { ...facts, consoleErrors: Array(11).fill('e') } })).status === 'failed', 'a result with too many notes is rejected')

// ---- The Bridge, end to end through the real endpoint logic ----
const logs: string[] = []
function wire(): { deps: Deps, cfg: Config } {
  const cfgBox: { cfg?: Config } = {}
  const deps: Deps = {
    fetch: (async (url: any, init: any) => {
      const u = new URL(String(url))
      const token = String(init.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
      const body = init.body ? JSON.parse(init.body) : {}
      const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status })
      try {
        const device = await store.authenticate(token)
        if (!device) return json(401, { statusMessage: 'not connected' })
        if (u.pathname === '/api/bridge/poll') return json(200, await pollForJobs(store, device, token, body, { waitMs: 30, checkMs: 10 }))
        let m = u.pathname.match(/^\/api\/bridge\/jobs\/([^/]+)\/result$/)
        if (m) return json(200, await reportJob(store, device, decodeURIComponent(m[1]!), body))
        m = u.pathname.match(/^\/api\/bridge\/jobs\/([^/]+)\/file$/)
        if (m) return json(200, await uploadJobFile(store, device, decodeURIComponent(m[1]!), body, saveFile))
        return json(404, {})
      } catch (e: any) { return json(e instanceof ApiError ? e.status : 500, { statusMessage: e.message }) }
    }) as any,
    sleep: async () => {}, now: () => clock, log: l => logs.push(l), platform: () => 'windows', osRelease: () => 'Windows_NT 10.0.26100',
    browser: { resolve, launch: fakeBrowser(async () => ({ status: 200 })) }
  }
  void cfgBox
  return { deps, cfg: { server: 'https://openlobs.example', deviceId: alice.deviceId, token: alice.token, name: 'Desk' } }
}
{
  const { deps, cfg } = wire()
  const j = await store.enqueue('alice', alice.deviceId, 'browser_look', { url: 'http://localhost:5173' })
  logs.length = 0
  await pollOnce({ ...cfg, allow: [] }, deps, new Map())
  const refused = await store.getJob('alice', j.id)
  assert(refused.status === 'failed' && /not been allowed/.test(refused.error) && logs.some(l => /not allowed this on this computer/.test(l)) && !refused.fileId, 'if the owner has not allowed it on this computer, the Bridge refuses even though the server asked')
  // The refusal also told the server: this computer now reports it allows nothing, so the next ask is refused up front.
  assert(((await rejects(() => store.enqueue('alice', alice.deviceId, 'browser_look', { url: 'http://localhost:5173' }))) as BridgeError)?.message.includes('allow browser'), 'once the owner turns it off, the server stops asking')
  await pollOnce({ ...cfg, allow: ['browser'] }, deps, new Map())
  const j3 = await store.enqueue('alice', alice.deviceId, 'browser_look', { url: 'http://localhost:5173' })
  await pollOnce({ ...cfg, allow: ['browser'] }, deps, new Map())
  const ok = await store.getJob('alice', j3.id)
  assert(ok.status === 'done' && !!ok.fileId && (ok.result as any).title === 'A page' && logs.some(l => /Running "browser_look"/.test(l)) && logs.some(l => /Finished "browser_look"/.test(l)), 'with permission, the Bridge looks, uploads the picture, and reports')
  const back = await files.get(ok.fileId!, 'alice')
  assert(back?.bytes[0] === 0xFF && back.bytes[1] === 0xD8, 'the picture can be fetched again by its owner only')
  assert((await files.get(ok.fileId!, 'bob')) === null, "and nobody else can get it")
  // A bad address that slipped past the server is still refused by the Bridge.
  const reports: any[] = []
  const hostile: Deps = { ...deps, fetch: (async (url: any, init: any) => {
    const p = new URL(String(url)).pathname
    if (p === '/api/bridge/poll') return new Response(JSON.stringify({ jobs: [{ id: 'jx', kind: 'browser_look', input: { url: 'file:///C:/Users/me/secrets.txt' } }, { id: 'jy', kind: 'browser_look', input: { url: 'http://192.168.0.1/' } }], cancel: [] }))
    reports.push({ p, body: JSON.parse(init.body) }); return new Response('{}')
  }) as any }
  await pollOnce({ ...cfg, allow: ['browser'] }, hostile, new Map())
  assert(reports.length === 2 && reports.every(r => r.p.endsWith('/result') && r.body.ok === false), 'the Bridge checks the address itself, whatever the server sends: a local file and a private network are both refused')
}

// ---- Asking from OpenLobs: choosing a computer and waiting for the answer ----
{
  const now = new Date('2026-10-22T10:00:30Z')
  clock = now
  const dev = (o: any) => ({ id: 'd', userId: 'alice', name: 'PC', platform: 'windows', bridgeVersion: '0.2.0', capabilities: ['ping', 'browser_look'], pairedAt: '', lastSeenAt: now.toISOString(), revokedAt: null, ...o })
  const msg = (f: () => unknown) => { try { f(); return '' } catch (e: any) { return e instanceof InspectError ? e.message : 'WRONG' } }
  assert(/No computer is connected/.test(msg(() => chooseComputer([], now))), 'no computers: says how to add one')
  assert(/offline/.test(msg(() => chooseComputer([dev({ lastSeenAt: '2026-10-22T09:00:00Z' })], now))), 'an offline computer is reported as offline')
  assert(/allow browser/.test(msg(() => chooseComputer([dev({ capabilities: ['ping'] })], now))), 'a computer that has not allowed it is told how to')
  assert(/no connected computer named/.test(msg(() => chooseComputer([dev({})], now, 'Nope'))), 'an unknown name lists the real ones')
  assert(chooseComputer([dev({ id: 'a', lastSeenAt: '2026-10-22T10:00:01Z' }), dev({ id: 'b', lastSeenAt: '2026-10-22T10:00:20Z' }), dev({ id: 'c', capabilities: ['ping'], lastSeenAt: '2026-10-22T10:00:29Z' })], now).id === 'b', 'the most recently active computer that allows it is used')
  assert(chooseComputer([dev({ id: 'a', name: 'Studio' }), dev({ id: 'b', name: 'Desk' })], now, 'desk').id === 'b', 'a computer can be chosen by name')
}
{
  const { deps, cfg } = wire()
  await store.touch((await store.authenticate(alice.token))!, { capabilities: ['ping', 'browser_look'] })
  const provider = bridgeProvider({ store, files, userId: 'alice', now: () => clock, pollMs: 5, timeoutMs: 5_000, sleep: async (ms) => { await new Promise(r => setTimeout(r, ms)) } })
  // Keep the Bridge polling in the background, as it would on a real computer.
  let stopBridge = false
  const loop = (async () => { while (!stopBridge) { await pollOnce({ ...cfg, allow: ['browser'] }, deps, new Map() as Map<string, Running>); await new Promise(r => setTimeout(r, 5)) } })()
  clock = new Date()
  await store.touch((await store.authenticate(alice.token))!, { capabilities: ['ping', 'browser_look'] })
  await db.collection('devices').doc(alice.deviceId).update({ lastSeenAt: new Date().toISOString() })
  const shot = await provider.capture({ url: 'http://localhost:5173/', width: 390 })
  stopBridge = true; await loop
  assert(shot.mediaType === 'image/jpeg' && shot.bytes[0] === 0xFF && shot.title === 'A page' && shot.facts?.computer === 'Desk' && shot.facts.status === 200, 'OpenLobs asks a computer for a screenshot and gets the picture and what the browser saw')
}
{
  // A computer that never answers: the look is cancelled, not left hanging.
  const dev = await pairNew('carol', 'Silent')
  await store.touch(dev.device, { capabilities: ['ping', 'browser_look'] })
  await db.collection('devices').doc(dev.deviceId).update({ lastSeenAt: new Date().toISOString() })
  const provider = bridgeProvider({ store, files, userId: 'carol', now: () => new Date(), pollMs: 5, timeoutMs: 60, sleep: async (ms) => { await new Promise(r => setTimeout(r, ms)) } })
  const e = await rejects(() => provider.capture({ url: 'https://example.com' }))
  const open = [...db.raw('bridge_jobs').values()].filter(j => j.userId === 'carol')
  assert(e instanceof InspectError && /did not answer in time/.test(e.message) && open.length === 1 && open[0]!.status === 'cancelled', 'a computer that does not answer in time is reported, and the job is cancelled')
  const c = new AbortController()
  const p2 = bridgeProvider({ store, files, userId: 'carol', now: () => new Date(), pollMs: 5, timeoutMs: 5000, sleep: async (ms) => { await new Promise(r => setTimeout(r, ms)) } }).capture({ url: 'https://example.com' }, c.signal)
  setTimeout(() => c.abort(), 30)
  const e2 = await rejects(() => p2)
  assert(e2 instanceof InspectError && [...db.raw('bridge_jobs').values()].filter(j => j.userId === 'carol' && j.status === 'cancelled').length === 2, 'stopping the chat reply cancels the look on the computer')
}

// ---- A real browser, when one is available here ----
const browserPath = process.env.OPENLOBS_BROWSER_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '')
if (!browserPath) console.log('SKIP the real-browser check (no Chromium found; set OPENLOBS_BROWSER_PATH)')
else {
  process.env.OPENLOBS_BROWSER_PATH = browserPath
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html')
      res.end('<!doctype html><title>Real Page</title><body style="background:#123456;color:#fff"><h1>Hello from a real page</h1><img src="/missing.png"><img src="http://10.255.255.1/secret.png"><script>console.error("real console error")</script></body>')
    } else { res.statusCode = 404; res.end('nope') }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  try {
    const out = await look(parseLookInput({ url: `http://127.0.0.1:${port}/`, width: 400, height: 300 }), noSignal)
    assert(out.image[0] === 0xFF && out.image[1] === 0xD8 && out.image.length > 500, 'REAL BROWSER: a real JPEG screenshot of a page on this computer')
    assert(out.facts.title === 'Real Page' && out.facts.status === 200, 'REAL BROWSER: the title and status are read')
    assert(out.facts.consoleErrors.some(e => /real console error/.test(e)), 'REAL BROWSER: a console error on the page is caught')
    assert(out.facts.failedRequests.some(f => f.startsWith('404') && f.includes('missing.png')), 'REAL BROWSER: a missing file is reported')
    assert(out.facts.failedRequests.some(f => /Blocked \(private network\)/.test(f) && f.includes('10.255.255.1')), 'REAL BROWSER: the page tried to reach a private-network address and the browser was stopped')
    const full = await look(parseLookInput({ url: `http://127.0.0.1:${port}/`, fullPage: true, width: 400, height: 300 }), noSignal)
    assert(full.facts.height >= 300, 'REAL BROWSER: a full-page look works')
    assert((await rejects(() => look(parseLookInput({ url: `http://127.0.0.1:1/` }), noSignal)))?.message.includes('could not be opened'), 'REAL BROWSER: a page that is not there gives a clear message')
  } finally { server.close() }
}
