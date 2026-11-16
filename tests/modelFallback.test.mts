import { createFakeFirestore } from './fakeFirestore'
import { taskInputSchema } from '../server/services/tasks/model'
import { createTaskStore } from '../server/services/tasks/store'
import { runTask } from '../server/services/tasks/orchestrator'
import type { RunDeps } from '../server/services/tasks/orchestrator'
import { verifyCriteria } from '../server/services/tasks/verify'
import { isModelOutOfRoom, modelErrorMessage } from '../server/utils/modelError'
import { nextAvailableModel } from '../server/utils/models'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

// ---- What counts as "out of room" ----
assert(isModelOutOfRoom(new Error('You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash')), 'a used-up daily allowance is out of room')
assert(isModelOutOfRoom(new Error('Rate limit reached for model on input tokens per minute (ITPM)')) && isModelOutOfRoom(new Error('503 UNAVAILABLE: high demand')), 'a rate limit and a busy model are out of room')
assert(isModelOutOfRoom(new Error('Request too large for model')), 'a message too big for this model is a reason to try another')
assert(!isModelOutOfRoom(new Error('Tool call validation failed')) && !isModelOutOfRoom(new Error('The file was not found')), 'ordinary errors are not')
assert(!/https?:|quota|metric/i.test(modelErrorMessage(new Error('You exceeded your current quota. https://ai.google.dev/rate-limit metric: x, limit: 20, model: y'))), 'the plain message has no links or quota jargon')

// ---- The next model to try ----
const keep = { g: process.env.GEMINI_API_KEY, q: process.env.GROQ_API_KEY, o: process.env.OPENAI_API_KEY, a: process.env.ANTHROPIC_API_KEY }
process.env.GEMINI_API_KEY = 'g'; process.env.GROQ_API_KEY = 'q'; delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY
assert(nextAvailableModel('google/gemini-3.5-flash', []) === 'google/gemini-3.5-flash', 'with nothing skipped, the preferred model is used')
assert(nextAvailableModel('google/gemini-3.5-flash', ['google/gemini-3.5-flash']) === 'groq/gpt-oss-120b', 'when the preferred one is out, the next provider takes over')
assert(nextAvailableModel('google/gemini-3.5-flash', ['google/gemini-3.5-flash', 'groq/gpt-oss-120b']) === 'google/gemini-3.1-flash-lite', 'then another model of a provider that is set up')
assert(nextAvailableModel('google/gemini-3.5-flash', ['google/gemini-3.5-flash', 'groq/gpt-oss-120b', 'google/gemini-3.1-flash-lite', 'groq/gpt-oss-20b']) === null, 'null when every model is out')
delete process.env.GROQ_API_KEY
assert(nextAvailableModel('google/gemini-3.5-flash', ['google/gemini-3.5-flash']) === 'google/gemini-3.1-flash-lite', 'a provider with no key is never picked')
for (const [k, v] of Object.entries({ GEMINI_API_KEY: keep.g, GROQ_API_KEY: keep.q, OPENAI_API_KEY: keep.o, ANTHROPIC_API_KEY: keep.a })) { if (v === undefined) delete process.env[k]; else process.env[k] = v }

// ---- A task carries on with another model ----
const harness = (generate: (args: any, n: number) => Promise<any>, models: string[]) => {
  const st = createTaskStore(createFakeFirestore() as any, {})
  const used: string[] = []
  const charges = { taken: 0, refunded: 0 }
  let calls = 0
  const deps: RunDeps = {
    store: st, tools: () => ({}),
    model: (_t, skip = []) => { const id = models.find(m => !skip.includes(m)); return id ? { id, model: { id } as any } : null },
    costOf: () => 1,
    charge: async () => { charges.taken++; return { refund: async () => { charges.refunded++ } } },
    verify: async (criteria, c) => verifyCriteria(criteria, c, { judgeCheck: async () => ({ status: 'met', reason: 'fine', fix: '' }) } as any),
    generate: (async (args: any) => { used.push(args.model.id); return await generate(args, ++calls) }) as any,
    pollMs: 15
  }
  return { st, deps, used, charges }
}
const run = async (h: ReturnType<typeof harness>, extra: Record<string, unknown> = {}) => {
  await h.st.create('alice', taskInputSchema.parse({ goal: 'Find one headline about Ghana technology.', criteria: [{ text: 'It names a source', kind: 'check' }], maxAttempts: 2, ...extra }))
  const c = (await h.st.claimNext())!
  return await runTask(c.task, c.lease, h.deps)
}
{
  const quota = new Error('You exceeded your current quota. limit: 20, model: gemini-3.5-flash, requests per day')
  const h = harness(async (args, n) => { if (n === 1) throw quota; return { text: 'Done, from BusinessGhana.' } }, ['google/a', 'groq/b'])
  const r = await run(h)
  const events = await h.st.events('alice', r.id)
  assert(r.status === 'done' && h.used.join() === 'google/a,groq/b', 'a model that runs out of allowance is replaced and the task finishes')
  assert(r.attempts === 1, 'switching model does not use up an attempt')
  assert(events.some(e => e.kind === 'note' && /out of room/.test(e.text) && /goes on with/.test(e.text)), 'the log says it switched')
  assert(h.charges.taken === h.charges.refunded + 1, 'the failed call is refunded, the working one is charged')
}
{
  const busy = new Error('503 UNAVAILABLE: This model is currently experiencing high demand.')
  const h = harness(async (args, n) => { if (n <= 2) throw busy; return { text: 'Done.' } }, ['google/a', 'groq/b', 'google/c'])
  const r = await run(h)
  assert(r.status === 'done' && h.used.join() === 'google/a,groq/b,google/c', 'it can switch more than once')
}
{
  const quota = new Error('Quota exceeded: requests per day')
  const h = harness(async () => { throw quota }, ['google/a', 'groq/b'])
  const r = await run(h)
  assert(r.status === 'failed' && /used up its free allowance|out of room/.test(r.outcome) && !/https?:/.test(r.outcome), 'when every model is out, the task fails in plain words')
  assert(h.used.join() === 'google/a,groq/b,groq/b', 'each model is skipped once it is out; the last one is retried as before, within the attempts')
}
{
  const h = harness(async () => { throw new Error('Tool call validation failed') }, ['google/a', 'groq/b'])
  const r = await run(h)
  assert(r.status === 'failed' && h.used.every(m => m === 'google/a') && /kept failing/.test(r.outcome), 'an ordinary error does not switch model, it retries as before')
}
