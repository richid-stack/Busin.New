import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFakeFirestore } from './fakeFirestore'
import { LIMITS, jobTtlMs } from '../server/services/bridge/model'
import { createBridgeStore } from '../server/services/bridge/store'
import { ApiError, pairDevice, pollForJobs, reportJob } from '../server/services/bridge/api'
import { activeKinds, pair, pollOnce } from '../bridge/core'
import type { Config, Deps, Running } from '../bridge/core'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as Error } return null }
const until = async (fn: () => Promise<boolean> | boolean, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 50)) } return false }

// A real server store and real server rules, a real Bridge, and a real folder. Only the network is replaced.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'olb-jobs-')))
fs.writeFileSync(path.join(root, 'hi.js'), "console.log('hi from the computer')")
fs.writeFileSync(path.join(root, 'long.js'), "require('node:fs').writeFileSync('started.txt', String(process.pid)); setInterval(() => {}, 1000)")

const db = createFakeFirestore()
const store = createBridgeStore(db as any)
const deps: Deps = {
  fetch: (async (url: any, init: any) => {
    const u = new URL(String(url))
    const token = String(init.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
    const body = init.body ? JSON.parse(init.body) : {}
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status })
    try {
      if (u.pathname === '/api/bridge/pair') return json(200, await pairDevice(store, body))
      const device = await store.authenticate(token)
      if (!device) return json(401, { statusMessage: 'not connected' })
      if (u.pathname === '/api/bridge/poll') return json(200, await pollForJobs(store, device, token, body, { waitMs: 40, checkMs: 20 }))
      const m = u.pathname.match(/^\/api\/bridge\/jobs\/([^/]+)\/result$/)
      if (m) return json(200, await reportJob(store, device, decodeURIComponent(m[1]!), body))
      return json(404, {})
    } catch (e: any) { return json(e instanceof ApiError ? e.status : 500, { statusMessage: e.message }) }
  }) as any,
  sleep: async () => {},
  now: () => new Date(),
  log: () => {},
  platform: () => process.platform as any,
  osRelease: () => os.release(),
  run: { env: { PATH: process.env.PATH, HOME: root } as NodeJS.ProcessEnv }
}
const cfg: Config = { ...(await pair('https://openlobs.example', (await store.createPairing('rae')).code, 'Rae PC', deps)), allow: ['run'], runFolder: root }
const id = cfg.deviceId
await pollOnce(cfg, deps, new Map()) // the first call in tells the server what this computer allows

// ---- What the computer tells the server it may do ----
assert(activeKinds({ allow: ['run'], runFolder: root }).join() === 'ping,run_command,folder_look,folder_read', 'allowing commands also allows looking at the same folder, and nothing else')
assert(activeKinds({ allow: ['run'] }).join() === 'ping', 'with no folder chosen, nothing about commands is offered')
assert(activeKinds({ allow: ['excel'], runFolder: root }).join() === 'ping', 'a folder alone allows nothing')

// ---- Server-side rules on the queue ----
assert((await rejects(() => store.enqueue('rae', id, 'run_command', { program: 'bash', args: ['-c', 'ls'] }))) !== null, 'the queue refuses a command that is not on the list')
assert((await rejects(() => store.enqueue('rae', id, 'run_command', { program: 'git', args: ['push'] })))?.message.includes('push') === true, 'and says why')
const queued = await store.enqueue('rae', id, 'run_command', { program: 'node', args: ['hi.js'] })
assert(new Date(queued.expiresAt).getTime() - new Date(queued.createdAt).getTime() === jobTtlMs('run_command') && jobTtlMs('run_command') > 2 * LIMITS.jobTtlMs && jobTtlMs('ping') === LIMITS.jobTtlMs, 'a command may stay open for minutes; other jobs keep their two minutes')

// ---- It runs, and the answer comes back checked ----
const running = new Map<string, Running>()
await pollOnce(cfg, deps, running)
const done = await store.getJob('rae', queued.id)
assert(done.status === 'done' && (done.result as any).exitCode === 0 && /hi from the computer/.test((done.result as any).output), 'the Bridge runs the command and the server accepts the result')

// ---- A long command does not hold up the Bridge, and the stop button works ----
const long = await store.enqueue('rae', id, 'run_command', { program: 'node', args: ['long.js'], limitMs: 60_000 })
const t0 = Date.now()
const tasks = new Set<Promise<void>>()
await pollOnce(cfg, deps, running, undefined, tasks)
assert(Date.now() - t0 < 3000 && (await store.getJob('rae', long.id)).status === 'sent', 'a long command does not block the Bridge from calling in')
assert(await until(() => fs.existsSync(path.join(root, 'started.txt'))), 'the program really started')
const pid = Number(fs.readFileSync(path.join(root, 'started.txt'), 'utf8'))
await store.cancelJob('rae', long.id)
await pollOnce(cfg, deps, running, undefined, tasks)
await Promise.all([...tasks])
const gone = await until(() => { try { process.kill(pid, 0) } catch { return true } try { return /^\d+ \(.*\) [ZX]/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')) } catch { return false } })
assert(gone, 'cancelling the job from OpenLobs stops the program on the computer')

// ---- Looking ----
const look = await store.enqueue('rae', id, 'folder_look', {})
await pollOnce(cfg, deps, running)
const looked = await store.getJob('rae', look.id)
assert(looked.status === 'done' && (looked.result as any).entries.some((e: any) => e.name === 'hi.js'), 'the folder can be listed through the queue')
const rd = await store.enqueue('rae', id, 'folder_read', { file: 'hi.js' })
await pollOnce(cfg, deps, running)
assert((await store.getJob('rae', rd.id)).status === 'done', 'and a file read')

// ---- Not allowed on this computer ----
const noRun: Config = { ...cfg, allow: [], runFolder: root }
const other = await store.enqueue('rae', id, 'run_command', { program: 'node', args: ['hi.js'] })
await pollOnce(noRun, deps, new Map())
assert((await store.getJob('rae', other.id)).status !== 'done', 'a computer that is not allowed to run commands does not run them, whatever the server queues')

fs.rmSync(root, { recursive: true, force: true })
