import fs from 'node:fs'
import { createFakeFirestore } from './fakeFirestore'
import { markDeleting } from '../server/services/account/tombstone'
import { LIMITS, PAIRING_ALPHABET, isJobKind, isOnline, pairInputSchema } from '../server/services/bridge/model'
import { BridgeError, createBridgeStore, newPairingCode, publicDevice, publicJob } from '../server/services/bridge/store'
import { ApiError, pairDevice, pollForJobs, reportJob } from '../server/services/bridge/api'
import { BRIDGE_VERSION, HANDLERS, checkServer, disconnect, pair, pollOnce, run } from '../bridge/core'
import type { Config, Deps, Running } from '../bridge/core'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as Error } return null }
const code = (e: unknown) => (e as BridgeError)?.code

let clock = new Date('2026-10-22T10:00:00Z')
const tick = (ms: number) => { clock = new Date(clock.getTime() + ms) }
const db = createFakeFirestore()
const store = createBridgeStore(db as any, { now: () => clock })
const info = { name: 'Richie laptop', platform: 'windows' as const, version: '0.1.0' }

// ---- Codes ----
const c1 = newPairingCode()
assert(/^[A-Z0-9]{8}$/.test(c1) && [...c1].every(ch => PAIRING_ALPHABET.includes(ch)) && !/[01OIL]/.test(PAIRING_ALPHABET), 'a pairing code is 8 characters that cannot be mistaken for each other')
assert(pairInputSchema.safeParse({ code: 'abcd-efgh', name: 'x', version: '1' }).success && !pairInputSchema.safeParse({ code: 'short', name: 'x', version: '1' }).success, 'a typed code is tidied (case, dash) and must be 8 characters')
assert(isJobKind('ping') && !isJobKind('shell') && !isJobKind('') && !isJobKind(undefined), 'only known job kinds are jobs')

// ---- Pairing ----
const p1 = await store.createPairing('alice')
assert(/^[A-Z0-9]{8}$/.test(p1.code) && p1.expiresAt === new Date(clock.getTime() + LIMITS.pairingTtlMs).toISOString(), 'a code lasts 10 minutes')
assert(![...db.raw('bridge_pairings').keys()].includes(p1.code), 'the code itself is not stored, only its hash')
const paired = await store.redeemPairing(p1.code, info)
assert(paired.token.startsWith('olb_') && paired.token.length > 40 && !!paired.deviceId, 'redeeming gives a device token')
const devDoc = [...db.raw('devices').values()][0]!
assert(devDoc.tokenHash && devDoc.tokenHash !== paired.token && !JSON.stringify(devDoc).includes(paired.token), 'the token is stored only as a hash')
assert((await rejects(() => store.redeemPairing(p1.code, info))) instanceof BridgeError, 'a code works once')
const p2 = await store.createPairing('alice')
const p3 = await store.createPairing('alice')
assert((await rejects(() => store.redeemPairing(p2.code, info))) instanceof BridgeError && (await store.redeemPairing(p3.code, { ...info, name: 'Second' })).deviceId !== paired.deviceId, 'a new code replaces the old one')
const p4 = await store.createPairing('alice')
tick(LIMITS.pairingTtlMs + 1000)
assert((await rejects(() => store.redeemPairing(p4.code, info)))?.message.includes('not valid or has expired') && (await rejects(() => store.redeemPairing('ZZZZZZZZ', info)))?.message.includes('not valid or has expired'), 'an expired or wrong code gets the same message, so guessing learns nothing')
await store.redeemPairing((await store.createPairing('alice')).code, { ...info, name: 'Third' })
assert(code(await rejects(() => store.createPairing('alice'))) === 'limit', 'at most 3 computers per person')
await markDeleting(db, 'dora')
assert(await rejects(() => store.createPairing('dora')) !== null, 'nothing is paired for an account being deleted')

// ---- Authentication and revocation ----
const dev = (await store.authenticate(paired.token))!
assert(dev?.id === paired.deviceId && (await store.authenticate('olb_nonsense')) === null && (await store.authenticate('not-a-token')) === null && (await store.authenticate('x'.repeat(300))) === null, 'a device token identifies its computer; anything else is refused')
assert(!('tokenHash' in publicDevice(dev)) && !('userId' in publicDevice(dev)), 'the browser never sees the token hash or ids')
assert(isOnline({ lastSeenAt: clock.toISOString(), revokedAt: null }, clock) && !isOnline({ lastSeenAt: clock.toISOString(), revokedAt: null }, new Date(clock.getTime() + 61_000)), 'a computer is online for a minute after it last called in')
assert((await store.listDevices('alice')).length === 3 && (await store.listDevices('bob')).length === 0, 'people only see their own computers')
assert(code(await rejects(() => store.getDevice('bob', dev.id))) === 'not_found' && code(await rejects(() => store.enqueue('bob', dev.id, 'ping'))) === 'not_found', 'nobody else can see or use someone\'s computer')

// ---- Jobs ----
const j1 = await store.enqueue('alice', dev.id, 'ping')
assert(j1.status === 'queued' && j1.kind === 'ping', 'a ping job is queued')
assert(code(await rejects(() => store.enqueue('alice', dev.id, 'rm -rf' as any))) === 'invalid', 'a kind that is not on the list cannot be queued')
const claim1 = await store.claimJobs(dev.id)
assert(claim1.jobs.length === 1 && claim1.jobs[0]!.status === 'sent' && (await store.claimJobs(dev.id)).jobs.length === 0, 'a job is handed out once')
assert(code(await rejects(() => store.reportResult('some-other-device', j1.id, { ok: true, result: {} }))) === 'not_found', 'only the computer a job was sent to can answer it')
const good = { bridgeVersion: '0.1.0', platform: 'windows', osVersion: 'Windows_NT 10.0', time: clock.toISOString(), capabilities: ['ping'] }
const done = await store.reportResult(dev.id, j1.id, { ok: true, result: good })
assert(done.status === 'done' && (done.result as any).platform === 'windows', 'a good answer finishes the job')
assert(code(await rejects(() => store.reportResult(dev.id, j1.id, { ok: true, result: good }))) === 'conflict', 'a job can only be answered once')
const j2 = await store.enqueue('alice', dev.id, 'ping'); await store.claimJobs(dev.id)
assert((await store.reportResult(dev.id, j2.id, { ok: true, result: { ...good, evil: 'extra' } })).status === 'failed', 'an answer with anything unexpected in it is rejected, not stored')
const j3 = await store.enqueue('alice', dev.id, 'ping'); await store.claimJobs(dev.id)
const failed = await store.reportResult(dev.id, j3.id, { ok: false, error: 'x'.repeat(1000) })
assert(failed.status === 'failed' && failed.error.length === 300, 'a failure is recorded, and long messages are cut')
const j4 = await store.enqueue('alice', dev.id, 'ping')
tick(LIMITS.jobTtlMs + 1000)
assert((await store.claimJobs(dev.id)).jobs.length === 0 && (await store.getJob('alice', j4.id)).status === 'expired', 'a job nobody picked up in 2 minutes expires')
// Cancelling
const j5 = await store.enqueue('alice', dev.id, 'ping')
assert((await store.cancelJob('alice', j5.id)).status === 'cancelled' && (await store.claimJobs(dev.id)).jobs.length === 0, 'a queued job that is cancelled is never sent')
const j6 = await store.enqueue('alice', dev.id, 'ping'); await store.claimJobs(dev.id)
await store.cancelJob('alice', j6.id)
const withCancel = await store.claimJobs(dev.id)
assert(withCancel.cancel.includes(j6.id), 'a job already sent is reported to the computer as cancelled')
await store.reportResult(dev.id, j6.id, { ok: false, cancelled: true })
assert(!(await store.claimJobs(dev.id)).cancel.includes(j6.id), 'once the computer confirms, it is not told again')
assert(code(await rejects(() => store.cancelJob('bob', j6.id))) === 'not_found' && code(await rejects(() => store.cancelJob('alice', j1.id))) === 'conflict', 'only the owner can cancel, and only an open job')
// Limits
for (let i = 0; i < LIMITS.maxOpenJobs; i++) await store.enqueue('alice', dev.id, 'ping')
assert(code(await rejects(() => store.enqueue('alice', dev.id, 'ping'))) === 'limit', 'at most 5 jobs waiting per computer')
assert(!('userId' in publicJob(j1)), 'jobs shown in the browser carry no owner id')

// ---- Activity and last-seen ----
{
  const s2 = createBridgeStore(createFakeFirestore() as any, { now: () => clock })
  const paired2 = await s2.redeemPairing((await s2.createPairing('eve')).code, info)
  for (let i = 0; i < 120; i++) await s2.addEvent(paired2.deviceId, 'note', `n${i}`)
  await s2.revoke('eve', paired2.deviceId)
  const ev = await s2.events('eve', paired2.deviceId)
  assert(ev.length === LIMITS.maxEvents + 1 && ev.at(-1)!.kind === 'revoked', 'the activity log is capped, but a disconnect is always recorded')
}
{
  const writes: string[] = []
  const wdb = createFakeFirestore()
  const s3 = createBridgeStore(wdb as any, { now: () => clock })
  const pd = await s3.redeemPairing((await s3.createPairing('fay')).code, info)
  const d3 = (await s3.authenticate(pd.token))!
  const orig = wdb.collection('devices').doc(d3.id).update
  void orig; void writes
  tick(5000); await s3.touch(d3)
  const before = [...wdb.raw('devices').values()][0]!.lastSeenAt
  tick(10_000); await s3.touch({ ...d3, lastSeenAt: before })
  assert([...wdb.raw('devices').values()][0]!.lastSeenAt === before, 'a computer calling in every few seconds is noted at most every 30 seconds')
  tick(31_000); await s3.touch({ ...d3, lastSeenAt: before })
  assert([...wdb.raw('devices').values()][0]!.lastSeenAt !== before, 'and again after 30 seconds')
  await s3.touch({ ...d3, lastSeenAt: [...wdb.raw('devices').values()][0]!.lastSeenAt }, { capabilities: ['ping', 'new'] })
  assert((await s3.getDevice('fay', d3.id)).capabilities.join() === 'ping,new', 'a change in what the computer can do is noted at once')
}

// ---- Revoking ----
const open = await store.enqueue('alice', (await store.listDevices('alice'))[1]!.id, 'ping').catch(() => null)
void open
const victim = (await store.listDevices('alice'))[0]!
await store.revoke('alice', victim.id)
assert((await store.authenticate(paired.token)) === null && (await store.listDevices('alice')).length === 2, 'disconnecting stops the token working at once and removes the computer from the list')
assert(code(await rejects(() => store.enqueue('alice', victim.id, 'ping'))) === 'conflict', 'a disconnected computer cannot be given jobs')
assert([...db.raw('bridge_jobs').values()].filter(j => j.deviceId === victim.id).every(j => !['queued', 'sent'].includes(j.status)), 'its open jobs are cancelled')

// ---- Endpoints (the real logic, with fake plumbing) ----
const s4db = createFakeFirestore()
const now4 = Date.now()
const s4 = createBridgeStore(s4db as any)
const pairing = await s4.createPairing('gina')
const dd = await pairDevice(s4, { code: pairing.code.toLowerCase(), name: 'Gina PC', platform: 'windows', version: '0.1.0' })
assert(!!dd.token && (await rejects(() => pairDevice(s4, { code: 'nope' }))) instanceof ApiError, 'pairing through the endpoint works, and a malformed body gets the plain "invalid code" answer')
const gd = (await s4.authenticate(dd.token))!
{
  const t0 = Date.now()
  const empty = await pollForJobs(s4, gd, dd.token, {}, { waitMs: 80, checkMs: 30 })
  assert(empty.jobs.length === 0 && empty.cancel.length === 0 && Date.now() - t0 >= 60, 'a poll with nothing waiting holds on, then answers empty')
  const waiting = pollForJobs(s4, gd, dd.token, {}, { waitMs: 3000, checkMs: 2000 })
  await new Promise(r => setTimeout(r, 30))
  const t1 = Date.now()
  await s4.enqueue('gina', gd.id, 'ping')
  const got = await waiting
  assert(got.jobs.length === 1 && Date.now() - t1 < 500, 'a job made while a poll waits is delivered at once')
  const waiting2 = pollForJobs(s4, gd, dd.token, {}, { waitMs: 3000, checkMs: 50 })
  await new Promise(r => setTimeout(r, 30))
  await s4.revoke('gina', gd.id)
  const gone: any = await waiting2
  assert(gone.revoked === true, 'a computer disconnected while it waits is told so')
  void now4
}
assert((await rejects(() => reportJob(s4, gd, 'nope', { ok: 'maybe' }))) instanceof ApiError, 'a malformed result is refused')

// ---- The Bridge itself, against the endpoints above ----
const s5db = createFakeFirestore()
const s5 = createBridgeStore(s5db as any)
const logs: string[] = []
const sleeps: number[] = []
function wire(): { deps: Deps, calls: string[] } {
  const calls: string[] = []
  const deps: Deps = {
    fetch: (async (url: any, init: any) => {
      const u = new URL(String(url)); calls.push(`${init.method} ${u.pathname}`)
      const token = String(init.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
      const body = init.body ? JSON.parse(init.body) : {}
      const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status })
      try {
        if (u.pathname === '/api/bridge/pair') return json(200, await pairDevice(s5, body))
        const device = await s5.authenticate(token)
        if (!device) return json(401, { statusMessage: 'not connected' })
        if (u.pathname === '/api/bridge/poll') return json(200, await pollForJobs(s5, device, token, body, { waitMs: 40, checkMs: 20 }))
        if (u.pathname === '/api/bridge/disconnect') { await s5.revoke(device.userId, device.id); return json(200, { success: true }) }
        const m = u.pathname.match(/^\/api\/bridge\/jobs\/([^/]+)\/result$/)
        if (m) return json(200, await reportJob(s5, device, decodeURIComponent(m[1]!), body))
        return json(404, {})
      } catch (e: any) {
        return json(e instanceof ApiError ? e.status : 500, { statusMessage: e.message })
      }
    }) as any,
    sleep: async (ms) => { sleeps.push(ms) },
    now: () => new Date('2026-10-22T12:00:00Z'),
    log: l => logs.push(l),
    platform: () => 'windows',
    osRelease: () => 'Windows_NT 10.0.26100'
  }
  return { deps, calls }
}
const { deps, calls } = wire()
assert((() => { try { checkServer('http://example.com'); return false } catch { return true } })() && (() => { try { checkServer('https://u:p@example.com'); return false } catch { return true } })() && (() => { try { checkServer('nonsense'); return false } catch { return true } })(), 'the Bridge refuses a plain http or credentialed server address')
assert(checkServer('https://openlobs.example/some/path') === 'https://openlobs.example' && checkServer('http://localhost:3000') === 'http://localhost:3000', 'https is required, except for a server on this machine')
assert((await rejects(() => pair('https://openlobs.example', 'WRONGCOD', 'PC', deps)))?.message.includes('not valid or has expired'), 'pairing with a wrong code explains itself')
const pr = await s5.createPairing('hana')
const cfg: Config = await pair('https://openlobs.example', pr.code, 'Hana PC', deps)
assert(cfg.token.startsWith('olb_') && cfg.name === 'Hana PC', 'the Bridge pairs with a code')
const running = new Map<string, Running>()
logs.length = 0
const hanaId = cfg.deviceId
const job = await s5.enqueue('hana', hanaId, 'ping')
assert(await pollOnce(cfg, deps, running) === true, 'a poll keeps going while connected')
const after = await s5.getJob('hana', job.id)
assert(after.status === 'done' && (after.result as any).platform === 'windows' && (after.result as any).bridgeVersion === BRIDGE_VERSION && (after.result as any).osVersion === 'Windows_NT 10.0.26100', 'the Bridge answers a ping with real details about this computer')
assert(logs.some(l => /Running "ping"/.test(l)) && logs.some(l => /Finished "ping"/.test(l)), 'the Bridge says out loud what it is doing')
assert((await s5.getDevice('hana', hanaId)).capabilities.join() === Object.keys(HANDLERS).join(), 'the server learns what this Bridge can do')

// A job kind this Bridge does not know is refused here, whatever the server says.
{
  const reports: any[] = []
  const evilDeps: Deps = { ...deps, fetch: (async (url: any, init: any) => {
    const p = new URL(String(url)).pathname
    if (p === '/api/bridge/poll') return new Response(JSON.stringify({ jobs: [{ id: 'j9', kind: 'run_command', input: { cmd: 'del /s C:\\' } }, { id: 'j10', kind: '__proto__', input: {} }, { id: 'j11', kind: 'constructor', input: {} }], cancel: [] }))
    reports.push({ p, body: JSON.parse(init.body) })
    return new Response('{}')
  }) as any }
  logs.length = 0
  await pollOnce(cfg, evilDeps, new Map())
  assert(reports.length === 3 && reports.every(r => r.body.ok === false && /does not do that/.test(r.body.error)) && logs.filter(l => /^Refused/.test(l)).length === 3, 'unknown jobs (even ones named like built-in object properties) are refused and reported, never run')
}

// Stop reaches a running job
{
  let aborted = false
  HANDLERS.slow = { label: 'A slow test job', run: async (_i, { signal }) => { await new Promise<void>(r => signal.addEventListener('abort', () => { aborted = true; r() })); throw new Error('aborted') } }
  const cancelDeps = wire()
  const state = new Map<string, Running>()
  const reported: any[] = []
  const slowFetch = cancelDeps.deps.fetch
  const d2: Deps = { ...cancelDeps.deps, fetch: (async (url: any, init: any) => { if (new URL(String(url)).pathname.endsWith('/result')) reported.push(JSON.parse(init.body)); return slowFetch(url, init) }) as any }
  // Hand the job straight to the Bridge, as the endpoint would.
  const fake: Deps = { ...d2, fetch: (async (url: any, init: any) => {
    const p = new URL(String(url)).pathname
    if (p === '/api/bridge/poll') return new Response(JSON.stringify(state.size ? { jobs: [], cancel: ['js1'] } : { jobs: [{ id: 'js1', kind: 'slow', input: {} }], cancel: [] }))
    reported.push(JSON.parse(init.body)); return new Response('{}')
  }) as any }
  const first = pollOnce(cfg, fake, state)
  await new Promise(r => setTimeout(r, 20))
  const second = await pollOnce(cfg, fake, state)
  await first
  assert(second === true && aborted && reported.some(r => r.cancelled === true) && state.size === 0, 'a cancel from OpenLobs reaches the running job, which stops and reports that it was cancelled')
  delete HANDLERS.slow
}

// The loop: backs off when the network is down, stops for good when disconnected
{
  const l = { logs: [] as string[] }
  let n = 0
  const flaky: Deps = { ...deps, log: x => l.logs.push(x), sleep: async (ms) => { sleeps.push(ms) }, fetch: (async () => { n++; if (n <= 4) throw new Error('ENOTFOUND'); return new Response(JSON.stringify({ revoked: true })) }) as any }
  sleeps.length = 0
  const ctl = new AbortController()
  const result = await run(cfg, flaky, ctl.signal)
  assert(result === 'disconnected' && sleeps.join() === '1000,2000,4000,8000', 'with no network the Bridge waits 1, 2, 4, 8 seconds between tries, then stops for good when told it was disconnected')
  const gone: Deps = { ...deps, log: x => l.logs.push(x), fetch: (async () => new Response('{}', { status: 401 })) as any }
  assert(await run(cfg, gone, new AbortController().signal) === 'disconnected' && l.logs.some(x => /no longer recognises/.test(x)), 'a 401 means this computer was disconnected, and the Bridge stops')
  const ctl2 = new AbortController(); ctl2.abort()
  assert(await run(cfg, deps, ctl2.signal) === 'stopped', 'Ctrl+C stops it')
}

// Disconnecting from the computer
await disconnect(cfg, deps)
assert((await s5.authenticate(cfg.token)) === null && calls.includes('POST /api/bridge/disconnect'), '"bridge disconnect" makes OpenLobs forget the computer')

// ---- The Bridge opens no door ----
for (const f of ['bridge/core.ts', 'bridge/cli.ts']) {
  const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
  assert(!/node:http|node:https|node:net|node:dgram|createServer|\.listen\(|child_process|\bexec(Sync)?\(|\bspawn(Sync)?\(/.test(src), `${f} opens no port and starts no programs`)
}
