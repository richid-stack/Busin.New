import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createFakeFirestore } from './fakeFirestore'
import { createBridgeStore } from '../server/services/bridge/store'
import { ApiError, answerLive, pollForJobs, reportJob } from '../server/services/bridge/api'
import { createLiveBroker, liveReplySchema } from '../server/services/bridge/live'
import { BridgeBrowserService } from '../server/services/bridge/browserService'
import { pairDevice } from '../server/services/bridge/api'
import { BrowserError } from '../server/services/browser/model'
import { HANDLERS, activeKinds, pollOnce, run } from '../bridge/core'
import type { Config, Deps, Running } from '../bridge/core'
import { DeviceBrowser } from '../bridge/deviceBrowser'
import { createLiveHost } from '../bridge/liveHost'
import { isLiveOp } from '../shared/bridgeLive'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const fails = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as Error } return null }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---- The broker: steps in memory ----
{
  const woke: string[] = []
  const b = createLiveBroker(id => woke.push(id))
  const p = b.request('dev1', 'frame', 'u:c', {})
  assert(woke.join() === 'dev1' && b.has('dev1') && !b.has('dev2'), 'BROKER: a queued step wakes that computer\'s poll, and only that computer\'s')
  assert(b.take('dev2').length === 0, 'BROKER: another computer is handed nothing')
  const [req] = b.take('dev1')
  assert(req?.op === 'frame' && req.key === 'u:c' && b.take('dev1').length === 0 && !b.has('dev1'), 'BROKER: a step is handed over once')
  assert(b.reply('dev2', req!.id, { ok: true }) === false, 'BROKER: another computer cannot answer it')
  assert(b.reply('dev1', req!.id, { ok: true, result: 1 }) === true && (await p as any).result === 1 && b.reply('dev1', req!.id, { ok: true }) === false, 'BROKER: the right computer answers once')
  assert(b.reply('dev1', 'nope', { ok: true }) === false, 'BROKER: an unknown step is not accepted')

  const ac = new AbortController()
  const q = b.request('dev1', 'act', 'u:c', {}, { signal: ac.signal })
  ac.abort()
  assert((await fails(() => q))?.message === 'Cancelled.' && !b.has('dev1') && b.take('dev1').length === 0, 'BROKER: cancelling a step nobody took drops it')
  const ac2 = new AbortController()
  const q2 = b.request('dev1', 'act', 'u:c', {}, { signal: ac2.signal })
  const [r2] = b.take('dev1')
  ac2.abort()
  assert((await fails(() => q2))?.message === 'Cancelled.' && b.has('dev1') && b.takeStops('dev1').join() === r2!.id && b.takeStops('dev1').length === 0 && b.reply('dev1', r2!.id, { ok: true }) === false, 'BROKER: cancelling a step the computer is running tells the computer to stop, once')
  const late = await fails(() => b.request('dev1', 'status', 'u:c', {}, { timeoutMs: 30 }))
  assert(/did not answer in time/.test(late?.message ?? '') && !b.has('dev1'), 'BROKER: a computer that does not answer in time is reported')
  b.take('dev1')
  const dropped = b.request('dev3', 'frame', 'u:c', {})
  b.take('dev3')
  b.dropDevice('dev3', 'gone')
  assert((await dropped as any).error === 'gone', 'BROKER: disconnecting a computer fails its waiting steps')
  let many = 0
  for (let i = 0; i < 25; i++) b.request('dev9', 'status', 'u:c', {}).catch(() => { many++ })
  await wait(5)
  assert(many === 5, 'BROKER: a computer cannot have more than 20 steps waiting')
}

// ---- What a computer may answer with ----
assert(liveReplySchema.safeParse({ ok: true, result: { a: 1 } }).success && !liveReplySchema.safeParse({ ok: true, extra: 1 }).success && !liveReplySchema.safeParse({ ok: false }).success && !liveReplySchema.safeParse({ ok: 'yes' }).success, 'REPLY: answers are checked')
assert(!liveReplySchema.safeParse({ ok: true, frame: { imageBase64: 'x'.repeat(2_000_000), width: 1, height: 1, url: '', title: '', control: 'assistant', tabs: [] } }).success, 'REPLY: a huge picture is refused')
assert(isLiveOp('act') && !isLiveOp('evaluate') && !isLiveOp('') && !isLiveOp(undefined), 'only known live steps exist')

// ---- Everything together: server, Bridge, and a real browser on a real profile ----
const browserPath = process.env.OPENLOBS_BROWSER_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '')
if (!browserPath) {
  console.log('SKIP the real-browser checks (no Chromium found; set OPENLOBS_BROWSER_PATH)')
} else {
  process.env.OPENLOBS_BROWSER_PATH = browserPath
  const cookiesSeen: string[] = []
  const posts: string[] = []
  const site = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/set') { res.setHeader('Set-Cookie', ['login=richie; Max-Age=3600; Path=/', 'sess=abc; Path=/']); res.setHeader('Content-Type', 'text/html'); return void res.end('<title>Set</title><p>cookie set</p>') }
    if (url.pathname === '/whoami') { cookiesSeen.push(String(req.headers.cookie ?? '')); res.setHeader('Content-Type', 'text/html'); return void res.end(`<title>Who</title><p>cookies: ${req.headers.cookie ?? 'none'}</p>`) }
    if (url.pathname === '/pay') { posts.push('paid'); res.setHeader('Content-Type', 'text/html'); return void res.end('<title>Paid</title><p>paid</p>') }
    res.setHeader('Content-Type', 'text/html')
    res.end('<title>Shop</title><h1>Shop</h1><a href="/whoami">Who am I</a> <form action="/pay" method="get"><label>Password <input type="password" name="pw"></label><button type="submit">Pay now</button></form>')
  })
  await new Promise<void>(r => site.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(site.address() as any).port}`

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olb-profile-'))
  const db = createFakeFirestore()
  const store = createBridgeStore(db as any)
  const broker = createLiveBroker(id => store.wake(id))
  const paired = await pairDevice(store, { code: (await store.createPairing('hana')).code, name: 'Hana PC', platform: 'windows', version: '0.5.0' })
  const config: Config = { server: 'https://openlobs.example', deviceId: paired.deviceId, token: paired.token, name: 'Hana PC', allow: ['browser_use'] }

  const device = new DeviceBrowser({ profileDir, allowLocal: true })
  const logs: string[] = []
  const wire = (extra: Partial<Deps> = {}): Deps => ({
    fetch: (async (url: any, init: any) => {
      const u = new URL(String(url))
      const token = String(init.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
      const body = init.body ? JSON.parse(init.body) : {}
      const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status })
      try {
        const dev = await store.authenticate(token)
        if (!dev) return json(401, { statusMessage: 'not connected' })
        if (u.pathname === '/api/bridge/poll') return json(200, await pollForJobs(store, dev, token, body, { waitMs: 150, checkMs: 50, live: broker }))
        const live = u.pathname.match(/^\/api\/bridge\/live\/([^/]+)$/)
        if (live) return json(200, answerLive(broker, dev, decodeURIComponent(live[1]!), body))
        const m = u.pathname.match(/^\/api\/bridge\/jobs\/([^/]+)\/result$/)
        if (m) return json(200, await reportJob(store, dev, decodeURIComponent(m[1]!), body))
        return json(404, {})
      } catch (e: any) {
        return json(e instanceof ApiError ? e.status : 500, { statusMessage: e.message })
      }
    }) as any,
    sleep: async ms => { await wait(Math.min(ms, 20)) },
    now: () => new Date(),
    log: l => logs.push(l),
    platform: () => 'windows',
    osRelease: () => 'Windows_NT 10.0',
    liveBrowser: createLiveHost(device),
    ...extra
  })

  const stop = new AbortController()
  const loop = run(config, wire(), stop.signal, () => config, 50)
  await wait(400)
  const svc = new BridgeBrowserService({ store, broker, userId: 'hana' })
  const key = 'hana:chat1'
  try {
    const caps = (await store.getDevice('hana', paired.deviceId)).capabilities
    assert(caps.includes('browser_session'), 'the server learns the computer can run a browser only because it was allowed there')

    const opened = await svc.act(key, { action: 'open', url: `${base}/` })
    assert(opened.state.title === 'Shop' && opened.state.elements.some(e => e.name.includes('Pay now')), 'BRIDGE BROWSER: the assistant opens a page in the browser on the computer and reads it')
    const pay = opened.state.elements.find(e => e.name.includes('Pay now'))!
    const pw = opened.state.elements.find(e => e.type === 'password')!
    assert(pw.sensitive === true, 'BRIDGE BROWSER: a password field is marked so the assistant never types in it')
    const ask = await svc.check(key, { action: 'click', ref: pay.ref })
    assert(ask.ask && /Pay now/.test(ask.label), 'BRIDGE BROWSER: the same rule asks before paying, decided on the computer from the live page')
    const refused = await fails(() => svc.act(key, { action: 'click', ref: pay.ref }))
    assert(refused instanceof BrowserError && posts.length === 0, 'BRIDGE BROWSER: a step that needs an OK is not done without one')
    const typed = await fails(() => svc.act(key, { action: 'type', ref: pw.ref, text: 'secret' }))
    assert(typed instanceof BrowserError && posts.length === 0, 'BRIDGE BROWSER: the assistant cannot type a password')

    const frame = await svc.frame(key)
    assert(frame !== null && frame.bytes[0] === 0xFF && frame.bytes[1] === 0xD8 && frame.width === 1100 && frame.tabs.length === 1 && frame.tabs[0]!.active && frame.control === 'assistant', 'BRIDGE BROWSER: the live picture arrives as a real JPEG with the tab strip')
    const status = await svc.status(key)
    assert(status?.control === 'assistant' && status.url.startsWith(base) && status.viewedAgoMs !== null, 'BRIDGE BROWSER: status says where the page is and that somebody looked')

    // The person takes over, types on the page, hands it back.
    await svc.takeOver(key)
    assert((await svc.frame(key))!.control === 'person', 'BRIDGE BROWSER: taking over shows in the picture')
    await svc.input(key, { kind: 'scroll', dy: 100 })
    const back = await svc.handBack(key)
    assert(back.title === 'Shop', 'BRIDGE BROWSER: handing back gives the assistant the page as it is now')

    // Sign-ins are kept: cookies set in one session are there in the next, and after the browser is closed.
    await svc.act(key, { action: 'open', url: `${base}/set` })
    await svc.close(key)
    await svc.act(key, { action: 'open', url: `${base}/whoami` })
    assert(/login=richie/.test(cookiesSeen.at(-1) ?? '') && /sess=abc/.test(cookiesSeen.at(-1) ?? ''), 'PROFILE: a new session on the same running browser is still signed in')
    await svc.close(key)
    await device.closeBrowser()
    await svc.act(key, { action: 'open', url: `${base}/whoami` })
    const afterRestart = cookiesSeen.at(-1) ?? ''
    assert(/login=richie/.test(afterRestart) && !/sess=abc/.test(afterRestart), 'PROFILE: after the browser is closed, a sign-in that has an expiry is remembered (one that lives only while the browser runs is not)')
    assert(fs.existsSync(path.join(profileDir, 'Default')), 'PROFILE: it lives in its own folder on disk, not in the person\'s everyday browser')

    // One session at a time; a new chat replaces the old page.
    await svc.act('hana:chat2', { action: 'open', url: `${base}/` })
    assert(await svc.status(key) === null && (await svc.status('hana:chat2')) !== null, 'one browser session at a time: a second chat replaces the first')

    // Hold, then a step ends it.
    await svc.hold('hana:chat2', 60_000)
    assert((await svc.status('hana:chat2'))!.holdLeftMs > 50_000, 'a wait for the person is kept on the computer')
    await svc.close('hana:chat2')
    assert((await fails(() => svc.act('hana:chat2', { action: 'read' })))?.message.includes('No page is open'), 'closing really closes the page')

    // A computer that has not allowed it, or is paused, refuses on its own, whatever the server asks.
    // The running Bridge is stopped first, so it is these deliberately restricted ones that answer.
    stop.abort()
    await loop.catch(() => {})
    const noPermission = wire()
    const running = new Map<string, Running>()
    const answers: any[] = []
    const probe = broker.request(paired.deviceId, 'status', 'hana:chat9', {})
    // Poll once with a deps that sees no permission.
    await pollOnce({ ...config, allow: [] }, noPermission, running)
    const refusal = await probe
    answers.push(refusal)
    assert(!(refusal as any).ok && /not been allowed/.test((refusal as any).error), 'a computer that has not allowed it refuses, even though the server asked')
    assert(!activeKinds({ allow: [] }).includes('browser_session') && activeKinds({ allow: ['browser_use'] }).includes('browser_session'), 'browser use is offered only after the person allows it')
    let pausedNow = true
    const paused = wire({ control: { paused: () => pausedNow, quitRequested: () => false, publish() {} } as any })
    const probe2 = broker.request(paired.deviceId, 'status', 'hana:chat9', {})
    await pollOnce(config, paused, running)
    const r2 = await probe2 as any
    assert(/paused/.test(String(r2.error)), 'a paused computer refuses browser steps')
    pausedNow = false
    const noHost = wire({ liveBrowser: undefined })
    const probe3 = broker.request(paired.deviceId, 'status', 'hana:chat9', {})
    await pollOnce(config, noHost, running)
    assert(!((await probe3) as any).ok, 'a Bridge with no browser to offer refuses too')

    // A page on this computer's own network is out of reach when development mode is off (the real setting).
    const strict = new DeviceBrowser({ profileDir: fs.mkdtempSync(path.join(os.tmpdir(), 'olb-profile2-')) })
    const strictHost = createLiveHost(strict)
    const reply = await strictHost.run({ id: 'x', op: 'act', key: 'hana:chat3', payload: { action: { action: 'open', url: `${base}/` } } }, new AbortController().signal)
    const blocked = !reply.ok || /blocked|could not|private|refus/i.test(JSON.stringify((reply as any).result?.state?.text ?? '')) || (reply as any).result?.state?.url === 'about:blank'
    assert(blocked && posts.length === 0, 'GUARD: the computer\'s own address and private network are refused by the guard, at the connection')
    await strict.closeBrowser()

    // A bad request is refused on the computer, not run.
    const bad = await createLiveHost(device).run({ id: 'y', op: 'act', key: 'hana:chat4', payload: { action: { action: 'evaluate', script: 'alert(1)' } } }, new AbortController().signal)
    assert(!bad.ok && (bad as any).code === 'bad_input', 'a step that is not on the list is refused on the computer')
    const badKey = await createLiveHost(device).run({ id: 'z', op: 'status', key: '../x', payload: {} }, new AbortController().signal)
    assert(!badKey.ok, 'a session key that is not valid is refused')
    assert(!('evaluate' in HANDLERS), 'there is no way to run a script')
  } finally {
    stop.abort()
    await loop.catch(() => {})
    await device.closeBrowser()
    site.close()
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
  assert(logs.every(l => !/secret/.test(l)), 'nothing typed on the page appears in the Bridge log')
}

// ---- Where the browser runs: the person's choice ----
{
  const { getBrowserWhere, setBrowserWhere, computerBrowserStatus } = await import('../server/services/browser/where')
  const { processHolds } = await import('../server/services/browser/holds')
  const db = createFakeFirestore()
  assert(await getBrowserWhere(db as any, 'u1') === 'cloud', 'WHERE: the browser runs in the cloud unless the person chooses their computer')
  await db.collection('user_settings').doc('u1').set({ userId: 'u1', emailRenewals: false })
  await setBrowserWhere(db as any, 'u1', 'computer')
  const doc = (await db.collection('user_settings').doc('u1').get()).data()
  assert(await getBrowserWhere(db as any, 'u1') === 'computer' && doc.emailRenewals === false, 'WHERE: choosing the computer keeps the other settings')
  assert(await getBrowserWhere(db as any, 'u2') === 'cloud', 'WHERE: it is per person')
  await setBrowserWhere(db as any, 'u1', 'cloud')
  assert(await getBrowserWhere(db as any, 'u1') === 'cloud', 'WHERE: and can be switched back')
  const dev = (over: Record<string, unknown>) => ({ id: 'd', name: 'Hana PC', capabilities: ['ping'], lastSeenAt: new Date().toISOString(), revokedAt: null, ...over })
  const status = (list: any[]) => computerBrowserStatus('u1', { store: { listDevices: async () => list } })
  assert(!(await status([])).ready && /Add one/.test((await status([])).note), 'WHERE: with no computer it says to add one')
  assert(!(await status([dev({})])).ready && /bridge allow browser_use/.test((await status([dev({})])).note), 'WHERE: a computer that has not allowed it says how')
  assert((await status([dev({ capabilities: ['ping', 'browser_session'] })])).ready, 'WHERE: an online computer that allowed it is ready')
  assert(/offline/.test((await status([dev({ capabilities: ['browser_session'], lastSeenAt: new Date(Date.now() - 10 * 60_000).toISOString() })])).note), 'WHERE: an allowed computer that is not running says it is offline')

  // Waits are looked after on whichever browser the person uses.
  const used: string[] = []
  const svcFor = (tag: string) => ({ close: async (k: string) => { used.push(`${tag}:close:${k}`) }, status: async () => null, hold: async () => {}, check: async () => ({ ask: false, label: '' }), act: async () => ({}), frame: async () => null, takeOver: async () => {}, handBack: async () => ({}), input: async () => {} }) as any
  const holds = [
    { key: 'a:chat', userId: 'a', kind: 'chat', ref: 'c', reason: 'person', label: '', createdAt: '2026-10-31T00:00:00Z', expiresAt: '2026-10-31T00:10:00Z', notifiedAt: null },
    { key: 'b:chat', userId: 'b', kind: 'chat', ref: 'c', reason: 'person', label: '', createdAt: '2026-10-31T00:00:00Z', expiresAt: '2026-10-31T00:10:00Z', notifiedAt: null }
  ]
  await processHolds({ store: { all: async () => holds, clear: async () => {}, markNotified: async () => {} } as any, service: null, serviceFor: async u => svcFor(u === 'a' ? 'computer' : 'cloud'), now: () => new Date('2026-10-31T01:00:00Z'), notify: async () => false, onExpired: async () => {} })
  assert(used.join() === 'computer:close:a:chat,cloud:close:b:chat', 'WAITS: an expired wait is closed on the browser that person uses')
}
process.exit(process.exitCode ?? 0)
