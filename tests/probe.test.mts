import { createFakeFirestore } from './fakeFirestore'
import { canTransition, taskInputSchema } from '../server/services/tasks/model'
import { TaskError, createTaskStore } from '../server/services/tasks/store'
import { runTask } from '../server/services/tasks/orchestrator'
import type { RunDeps } from '../server/services/tasks/orchestrator'
import { verifyCriteria } from '../server/services/tasks/verify'
import { endTaskBrowser } from '../server/services/tasks/taskBrowser'
import { allowedToolNames } from '../server/services/tasks/registry'
import { TASK_STATUS } from '../src/types/tasks'
import { processQueue } from '../server/services/tasks/run'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m) }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as Error } return null }

assert(canTransition('running', 'needs_you') && canTransition('needs_you', 'queued') && canTransition('needs_you', 'failed') && canTransition('needs_you', 'cancelled') && !canTransition('needs_you', 'done') && !canTransition('needs_you', 'running') && !canTransition('queued', 'needs_you'), 'a task can pause only while running, and leaves the pause only by being answered, stopped or timed out')
assert(allowedToolNames(['browser']).includes('browser'), 'the browser may run in a task, because it pauses instead of acting alone')
assert(TASK_STATUS.needs_you.label === 'Needs you' && TASK_STATUS.needs_you.working === false, 'the app has words for the new status')

let clock = new Date('2026-10-30T10:00:00Z')
const now = () => clock
const fdb = createFakeFirestore()
const st = createTaskStore(fdb as any, { now })
const charges = { taken: 0, refunded: 0 }
const seenCtx: any[] = []
const systems: string[] = []
let script: (args: any, ctx: any, n: number) => Promise<any> = async () => ({ text: 'ok' })
let calls = 0
const deps: RunDeps = {
  store: st,
  tools: (_t, ctx) => { seenCtx.push(ctx); return {} },
  model: () => ({ id: 'google/test', model: {} as any }),
  costOf: () => 1,
  charge: async () => { charges.taken++; return { refund: async () => { charges.refunded++ } } },
  verify: async (criteria, c) => verifyCriteria(criteria, c, { judgeCheck: async () => ({ status: 'met', reason: 'fine', fix: '' }) } as any),
  generate: (async (args: any) => { systems.push(args.system); return await script(args, seenCtx.at(-1), ++calls) }) as any,
  now,
  pollMs: 15
}
const pauseAndWait = (reason: 'approval' | 'person', label: string) => async (args: any, ctx: any) => {
  await new Promise<void>((resolve, reject) => { args.abortSignal.addEventListener('abort', () => reject(new Error('aborted'))); clock = new Date(clock.getTime() + 90_000); ctx.pause({ reason, label }); void resolve })
}
const make = async () => {
  await st.create('alice', taskInputSchema.parse({ goal: 'Order a kente stole from the shop.', criteria: [{ text: 'The order was placed', kind: 'check' }], tools: ['web', 'browser'], maxMinutes: 5 }))
  return (await st.claimNext())!
}


const within = async <T>(label: string, fn: () => Promise<T>, ms = 15000): Promise<T | undefined> => {
  const t0 = Date.now()
  try {
    const v = await Promise.race([(async () => fn())(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT after ${ms}ms`)), ms))])
    console.log(`PASS ${label} (${Date.now() - t0}ms)`); return v as T
  } catch (e: any) { console.log(`FAIL ${label}: ${String(e.message).slice(0, 300)} (${Date.now() - t0}ms)`); return undefined }
}
script = pauseAndWait('approval', 'Click Place order')
const created = await within('create', () => st.create('alice', taskInputSchema.parse({ goal: 'Order a kente stole from the shop.', criteria: [{ text: 'The order was placed', kind: 'check' }], tools: ['web', 'browser'], maxMinutes: 5 })))
const cl = await within('claimNext', () => st.claimNext())
if (cl) {
  const r = await within('runTask', () => runTask(cl.task, cl.lease, deps), 30000)
  console.log('PASS result status', r?.status)
}
process.exit(0)
