import { createFakeFirestore } from './fakeFirestore'
import { BridgeError, createBridgeStore } from '../server/services/bridge/store'
import { pollForJobs } from '../server/services/bridge/api'
import { HANDLERS, run } from '../bridge/core'
import type { Config, Deps } from '../bridge/core'
import type { Control } from '../bridge/control'
import { startBackground } from '../bridge/process'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as Error } return null }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const until = async (fn: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end && !fn()) await wait(10); return fn() }

const cfg: Config = { server: 'https://openlobs.example', deviceId: 'd1', token: 'olb_x', name: 'Test PC', allow: ['excel'], workspace: '/tmp' }

/** A stand-in for OpenLobs that answers polls from a script and records every call. */
function fakeServer(script: (n: number, body: any) => any, opts: { failReports?: number } = {}) {
  const polls: any[] = []
  const reports: any[] = []
  let reportFails = opts.failReports ?? 0
  const fetch = (async (url: any, init: any) => {
    const p = new URL(String(url)).pathname
    const body = init?.body ? JSON.parse(init.body) : {}
    if (p === '/api/bridge/poll') {
      polls.push(body)
      if (body.quick) return new Response('{}')
      await wait(40)
      return new Response(JSON.stringify(script(polls.filter(x => !x.quick).length, body) ?? { jobs: [], cancel: [] }))
    }
    if (/\/result$/.test(p)) {
      if (reportFails > 0) { reportFails--; throw new Error('network down') }
      reports.push({ id: decodeURIComponent(p.split('/')[4]!), ...body })
      return new Response('{}')
    }
    return new Response('{}')
  }) as any
  const logs: string[] = []
  const deps: Deps = { fetch, sleep: async (ms, signal) => { await new Promise<void>((r) => { const t = setTimeout(r, Math.min(ms, 30)); signal?.addEventListener('abort', () => { clearTimeout(t); r() }, { once: true }) }) }, now: () => new Date(), log: l => logs.push(l), platform: () => 'linux', osRelease: () => 'test' }
  return { deps, polls, reports, logs }
}
const control = (state: { paused?: boolean, quit?: boolean }): Control => ({ paused: () => !!state.paused, quitRequested: () => !!state.quit, publish: () => {} })

// ---- A running job does not hold up the next poll: a Stop reaches it ----
{
  let aborted = false
  const original = HANDLERS.workbook_list!
  HANDLERS.workbook_list = { label: 'list', run: async (_i, { signal }) => { await new Promise<void>(r => signal.addEventListener('abort', () => { aborted = true; r() }, { once: true })); return {} } }
  const s = fakeServer(n => n === 1 ? { jobs: [{ id: 'j2', kind: 'workbook_list', input: {} }], cancel: [] } : n === 3 ? { jobs: [], cancel: ['j2'] } : { jobs: [], cancel: [] })
  const stop = new AbortController()
  const done = run({ ...cfg }, { ...s.deps, control: control({}) }, stop.signal, undefined, 20)
  assert(await until(() => aborted), 'a Stop from OpenLobs reaches a job that is still running')
  assert(await until(() => s.reports.some(r => r.id === 'j2' && r.cancelled === true)), 'and the job is reported as cancelled')
  stop.abort(); await done

  // ---- Quit stops a running job, reports it, and only then returns ----
  aborted = false
  const s2 = fakeServer(n => n === 1 ? { jobs: [{ id: 'j3', kind: 'workbook_list', input: {} }], cancel: [] } : { jobs: [], cancel: [] })
  const st = { quit: false }
  const done2 = run({ ...cfg }, { ...s2.deps, control: control(st) }, new AbortController().signal, undefined, 20)
  await until(() => s2.logs.some(l => /Running "workbook_list"/.test(l)))
  st.quit = true
  const result = await done2
  assert(result === 'stopped' && aborted && s2.reports.some(r => r.id === 'j3' && r.cancelled === true), 'quitting stops the running job and tells OpenLobs before the Bridge ends')

  // ---- Pause: nothing is reported as "not allowed", and it is announced at once ----
  aborted = false
  const s3 = fakeServer(n => n === 1 ? { jobs: [{ id: 'j4', kind: 'workbook_list', input: {} }], cancel: [] } : { jobs: [], cancel: [] })
  const ps = { paused: false }
  const stop3 = new AbortController()
  const done3 = run({ ...cfg }, { ...s3.deps, control: control(ps) }, stop3.signal, undefined, 20)
  await until(() => s3.logs.some(l => /Running "workbook_list"/.test(l)))
  ps.paused = true
  assert(await until(() => aborted), 'pausing stops a running job')
  assert(await until(() => s3.polls.some(p => p.quick && p.paused === true)), 'a pause is announced straight away, not at the next poll')
  await wait(100)
  assert(s3.polls.filter(p => !p.quick && p.paused === true).every(p => p.capabilities.includes('workbook_list')), 'what the person allowed is still sent while paused; the pause is its own flag')
  ps.paused = false
  assert(await until(() => s3.polls.some(p => p.quick && p.paused === false)), 'resuming is announced straight away too')
  stop3.abort(); await done3

  // ---- Deny while a job runs stops it ----
  aborted = false
  const s4 = fakeServer(n => n === 1 ? { jobs: [{ id: 'j5', kind: 'workbook_list', input: {} }], cancel: [] } : { jobs: [], cancel: [] })
  let allow = ['excel']
  const stop4 = new AbortController()
  const done4 = run({ ...cfg }, { ...s4.deps, control: control({}) }, stop4.signal, () => ({ ...cfg, allow }), 10)
  await until(() => s4.logs.some(l => /Running "workbook_list"/.test(l)))
  allow = []
  assert(await until(() => aborted) && s4.logs.some(l => /no longer allow/.test(l)), 'taking away a permission stops the job that was using it')
  stop4.abort(); await done4
  HANDLERS.workbook_list = original
}

// ---- A lost result is sent again ----
{
  const original = HANDLERS.ping!
  const s = fakeServer(n => n === 1 ? { jobs: [{ id: 'j6', kind: 'ping', input: {} }], cancel: [] } : { jobs: [], cancel: [] }, { failReports: 2 })
  const stop = new AbortController()
  const done = run({ ...cfg }, { ...s.deps, control: control({}) }, stop.signal, undefined, 20)
  assert(await until(() => s.reports.some(r => r.id === 'j6' && r.ok === true), 5000), 'a result that could not be sent is sent again, and arrives')
  stop.abort(); await done
  HANDLERS.ping = original
}

// ---- A tray that cannot start does not take the Bridge down ----
{
  let crashed = false
  const onCrash = () => { crashed = true }
  process.once('uncaughtException', onCrash)
  const child = startBackground('this-program-does-not-exist-openlobs', [])
  await wait(300)
  process.off('uncaughtException', onCrash)
  child.kill()
  assert(!crashed, 'a program that cannot start (no PowerShell, no tray) is not a crash')
}

// ---- The server: pause, disconnect and expiry ----
{
  let clock = new Date('2026-11-01T10:00:00Z')
  const db = createFakeFirestore()
  const store = createBridgeStore(db as any, { now: () => clock })
  const p = await store.createPairing('u1')
  const paired = await store.redeemPairing(p.code, { name: 'PC', platform: 'windows', version: '0.5.0' })
  const dev = (await store.authenticate(paired.token))!
  await store.touch(dev, { capabilities: ['ping', 'workbook_list'] })

  await store.touch(dev, { paused: true })
  const e = await rejects(() => store.enqueue('u1', dev.id, 'ping'))
  assert(e instanceof BridgeError && /paused/.test(e.message), 'a paused computer is told apart from one that was never allowed, and nothing is queued')
  assert((await store.getDevice('u1', dev.id)).capabilities.join() === 'ping,workbook_list', 'pausing does not change what was allowed')
  await store.touch(dev, { paused: false })
  const j = await store.enqueue('u1', dev.id, 'ping')
  assert(j.status === 'queued', 'after a resume, jobs queue again')

  // A paused computer is handed no new work, but is still told to stop what was cancelled.
  await store.touch(dev, { paused: true })
  const polled = await pollForJobs(store, dev, paired.token, { paused: true }, { waitMs: 60, checkMs: 20 })
  assert(polled.jobs.length === 0, 'a paused computer is not handed jobs')
  const quick = await pollForJobs(store, dev, paired.token, { paused: false, quick: true }, { waitMs: 5000 })
  assert(quick.jobs.length === 0 && (await store.getDevice('u1', dev.id)).paused === false, 'a resume announced on its own is answered at once')
  const got = await pollForJobs(store, dev, paired.token, {}, { waitMs: 60, checkMs: 20 })
  assert(got.jobs.length === 1, 'and then the waiting job is handed over')

  // A result that arrives is never turned back into "expired".
  await store.reportResult(dev.id, j.id, { ok: true, result: { bridgeVersion: '0.5.0', platform: 'windows', time: 'x' } })
  clock = new Date(clock.getTime() + 60 * 60 * 1000)
  const later = await store.getJob('u1', j.id)
  assert(later.status === 'done', 'a finished job stays finished after its time is up')
  const j2 = await store.enqueue('u1', dev.id, 'ping')
  clock = new Date(clock.getTime() + 60 * 60 * 1000)
  assert((await store.getJob('u1', j2.id)).status === 'expired', 'a job nobody picked up does expire')

  // A disconnect wins over a job that was about to be saved.
  await store.revoke('u1', dev.id)
  const r = await rejects(() => store.enqueue('u1', dev.id, 'ping'))
  assert(r instanceof BridgeError, 'nothing can be queued on a computer that was disconnected')
}
