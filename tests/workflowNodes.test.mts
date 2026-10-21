import { executeWorkflowDAG, interpolateVariables } from '../server/utils/workflowEngine'
import { NodeConfigError, loopCap, mapWithConcurrency, runHttpNode, runSetNode, runWebFetchNode, spendOutbound } from '../server/utils/workflowNodes'
import type { NodeDeps } from '../server/utils/workflowNodes'
import { PageError } from '../server/services/web/reader'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>, kind?: any) => { try { await fn(); return false } catch (e) { return kind ? e instanceof kind : true } }
const wf = (nodes: any[], edges: any[]) => ({ id: 'w', title: 't', userId: 'u', status: 'active', nodes, edges, createdAt: new Date() }) as any
const n = (id: string, type: string, data: any = {}) => ({ id, type, data: { title: id, ...data } })
const e = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}-${sourceHandle ?? ''}`, source, target, sourceHandle })
const http = (config: any, settings?: any) => n('h', 'action', { subtype: 'api', config, settings })

type Call = { url: string, options: any }
const reply = (status: number, body: unknown, contentType = 'application/json') => ({
  status, url: 'https://api.example.com/x', contentType, headers: { 'content-type': contentType, 'set-cookie-ignored': 'x', 'retry-after': '3' },
  body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)), truncated: false
})
const fetcherOf = (answers: Array<() => any>, calls: Call[] = []) => {
  let i = 0
  const fn = async (url: string, options: any) => { calls.push({ url, options }); const next = answers[Math.min(i++, answers.length - 1)]!; return next() }
  return fn as NonNullable<NodeDeps['fetcher']>
}

// ---------- Set / Transform ----------
const ctx = { trigger: { payload: { name: 'Ama', amount: 40, tags: ['a', 'b'] } }, prev: { result: 5 } }
const set = await runSetNode({ fields: [
  { key: 'greeting', value: 'Hello {{trigger.payload.name}}', mode: 'text' },
  { key: 'double', value: 'prev.result * 2', mode: 'expression' },
  { key: 'tags', value: '{{trigger.payload.tags}}', mode: 'json' },
  { key: 'big', value: 'trigger.payload.amount > 30', mode: 'expression' }
] }, ctx)
assert(set.greeting === 'Hello Ama' && set.double === 10 && Array.isArray(set.tags) && (set.tags as any[]).length === 2 && set.big === true, 'Set builds text, formula and JSON values from earlier steps')
assert(await rejects(() => runSetNode({ fields: [] }, ctx), NodeConfigError), 'Set with no fields is a setup error')
assert(await rejects(() => runSetNode({ fields: [{ key: '__proto__', value: 'x' }] }, ctx), NodeConfigError) && await rejects(() => runSetNode({ fields: [{ key: 'a b', value: 'x' }] }, ctx), NodeConfigError), 'Set refuses dangerous or invalid field names')
assert(await rejects(() => runSetNode({ fields: [{ key: 'x', value: '{not json', mode: 'json' }] }, ctx), NodeConfigError), 'invalid JSON in a Set field is a setup error that names the field')
assert(interpolateVariables('{{constructor.name}} {{trigger.__proto__}}', ctx) === '[constructor.name] [trigger.__proto__]', 'placeholders cannot reach inherited properties')

// ---------- HTTP Request ----------
let calls: Call[] = []
let out: any = await runHttpNode({ method: 'post', url: 'https://api.example.com/users/{{trigger.payload.name}}', headers: [{ key: 'Authorization', value: 'Bearer abc' }, { key: 'Host', value: 'evil' }, { key: 'X-Name', value: '{{trigger.payload.name}}' }], body: '{"n":"{{trigger.payload.name}}"}' }, ctx, undefined, { fetcher: fetcherOf([() => reply(200, { ok: true, id: 7 })], calls) })
assert(calls[0]!.url === 'https://api.example.com/users/Ama' && calls[0]!.options.method === 'POST' && calls[0]!.options.body === '{"n":"Ama"}', 'HTTP fills placeholders in the URL and body and uses the method')
assert(calls[0]!.options.headers.Authorization === 'Bearer abc' && calls[0]!.options.headers['X-Name'] === 'Ama' && !('Host' in calls[0]!.options.headers) && calls[0]!.options.headers['Content-Type'] === 'application/json', 'HTTP keeps custom headers, drops Host, sets a JSON content type')
assert(calls[0]!.options.redirect === 'manual', 'HTTP never follows redirects on its own')
assert(out.status === 200 && out.ok === true && out.body.id === 7 && out.headers['retry-after'] === '3' && !('set-cookie-ignored' in out.headers), 'HTTP returns status, parsed JSON and a short list of headers')
calls = []
await runHttpNode({ method: 'GET', url: 'https://api.example.com/', body: 'ignored' }, ctx, undefined, { fetcher: fetcherOf([() => reply(200, 'hi', 'text/plain')], calls) })
assert(calls[0]!.options.body === undefined, 'a GET request carries no body')
assert(await rejects(() => runHttpNode({ url: 'https://api.example.com/', headers: [{ key: 'X-A', value: 'a\r\nInjected: 1' }] }, ctx, undefined, { fetcher: fetcherOf([() => reply(200, '')]) }), NodeConfigError), 'a header value with a line break is refused')
assert(await rejects(() => runHttpNode({ method: 'TRACE', url: 'https://a.example/' }, ctx, undefined, {}), NodeConfigError) && await rejects(() => runHttpNode({ url: '' }, ctx, undefined, {}), NodeConfigError) && await rejects(() => runHttpNode({ url: 'https://{{nothere.value}}.example.com/' }, ctx, undefined, { fetcher: fetcherOf([() => reply(200, '')]) }), NodeConfigError), 'bad method, empty URL and unresolved placeholders are setup errors')
for (const target of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://localhost:8080/admin', 'file:///etc/passwd', 'ftp://example.com/']) {
  assert(await rejects(() => runHttpNode({ url: target }, ctx, undefined, {}), NodeConfigError), `HTTP refuses ${target}`)
}
const failed = (status: number) => runHttpNode({ url: 'https://api.example.com/' }, ctx, undefined, { fetcher: fetcherOf([() => reply(status, { error: 'nope' })]) })
assert(await rejects(() => failed(404), NodeConfigError) && await rejects(() => failed(500)) && !(await rejects(() => failed(500), NodeConfigError)), 'a 404 is a setup error, a 500 is worth retrying')
out = await runHttpNode({ url: 'https://api.example.com/', failOnError: false }, ctx, undefined, { fetcher: fetcherOf([() => reply(404, { error: 'nope' })]) })
assert(out.status === 404 && out.ok === false && out.body.error === 'nope', 'with failOnError off the answer is returned for a later step to check')

// ---------- Web Fetch ----------
const page = { url: 'https://example.com/a', title: 'A', source: 'reader' as const, markdown: 'x'.repeat(5000) }
out = await runWebFetchNode({ url: 'https://example.com/{{prev.result}}', maxChars: 1000 }, ctx, undefined, { pageReader: async (u) => ({ ...page, url: u }) })
assert(out.content.length === 1000 && out.truncated === true && out.totalChars === 5000 && out.url === 'https://example.com/5', 'Web Fetch fills the URL, trims to maxChars and says it did')
assert(await rejects(() => runWebFetchNode({ url: 'http://127.0.0.1/' }, ctx, undefined, {}), NodeConfigError), 'Web Fetch refuses private addresses')
assert(await rejects(() => runWebFetchNode({ url: 'https://a.example/' }, ctx, undefined, { pageReader: async () => { throw new PageError('The page was not found (404).') } }), NodeConfigError), 'a missing page is not retried')
assert(!(await rejects(() => runWebFetchNode({ url: 'https://a.example/' }, ctx, undefined, { pageReader: async () => { throw new PageError('The website took too long to respond.') } }), NodeConfigError)), 'a slow page is worth retrying')

// ---------- Loop helpers ----------
let running = 0; let peak = 0
const mapped = await mapWithConcurrency([30, 5, 20, 1, 10, 2], 3, async (ms, i) => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, ms)); running--; return i })
assert(mapped.join() === '0,1,2,3,4,5' && peak === 3, 'the loop keeps order and never runs more than 3 at once')
assert(loopCap('web-fetch', undefined) === 20 && loopCap('web-fetch', 500) === 50 && loopCap('agent', 500) === 10 && loopCap('http', 0) === 1, 'loop size limits: 20 by default, 50 at most, 10 for AI steps')

// ---------- Loop inside a workflow ----------
const reader = async (url: string) => {
  if (url.includes('bad')) throw new PageError('The page was not found (404).')
  return { url, title: `T:${url}`, source: 'reader' as const, markdown: `body of ${url}` }
}
const loopNode = (config: any) => n('loop', 'logic', { subtype: 'loop', config })
let r = await executeWorkflowDAG(wf([n('t', 'trigger'), loopNode({ items: '{{trigger.payload.urls}}', body: { kind: 'web-fetch', config: { url: '{{item}}' } } })], [e('t', 'loop')]),
  { payload: { urls: ['https://a.example/1', 'https://bad.example/2', 'https://a.example/3'] } }, 'u', { deps: { pageReader: reader } })
const loop = r.outputs.loop
assert(r.status === 'completed' && loop.count === 3 && loop.succeeded === 2 && loop.failed === 1 && loop.results[0].title === 'T:https://a.example/1' && loop.results[1].failed === true && loop.outputs.length === 2, 'Loop runs the body per item, keeps order and reports the item that failed')
r = await executeWorkflowDAG(wf([n('t', 'trigger'), loopNode({ items: 'trigger.payload.urls', stopOnError: true, body: { kind: 'web-fetch', config: { url: '{{item}}' } } })], [e('t', 'loop')]),
  { payload: { urls: ['https://a.example/1', 'https://bad.example/2'] } }, 'u', { deps: { pageReader: reader } })
assert(r.status === 'failed' && /1 of 2 items failed/.test(r.logs.find(l => l.nodeId === 'loop')!.message || ''), 'with stopOnError a failed item fails the step')
r = await executeWorkflowDAG(wf([n('t', 'trigger'), loopNode({ items: 'trigger.payload.n', body: { kind: 'set', config: { fields: [{ key: 'x', value: '1' }] } } })], [e('t', 'loop')]), { payload: { n: 5 } }, 'u')
assert(r.status === 'failed' && /not a list/.test(r.logs.find(l => l.nodeId === 'loop')!.message || ''), 'a loop over something that is not a list explains itself')
r = await executeWorkflowDAG(wf([n('t', 'trigger'), loopNode({ items: 'trigger.payload.list', maxItems: 2, body: { kind: 'set', config: { fields: [{ key: 'label', value: 'row {{index}}: {{item.name}}' }] } } })], [e('t', 'loop')]), { payload: { list: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } }, 'u')
assert(r.outputs.loop.count === 2 && r.outputs.loop.skippedOverLimit === 1 && r.outputs.loop.results[1].label === 'row 1: b', 'a loop honours maxItems, says what it left out, and exposes {{item}} and {{index}}')
r = await executeWorkflowDAG(wf([n('t', 'trigger'), loopNode({ items: 'trigger.payload.list', body: { kind: 'http', config: { url: 'https://api.example.com/{{item}}' } } })], [e('t', 'loop')]), { payload: { list: [1, 2] } }, 'u', { deps: { fetcher: fetcherOf([() => reply(200, { ok: 1 })]) } })
assert(r.outputs.loop.succeeded === 2 && r.outputs.loop.results[0].body.ok === 1, 'a loop can send an HTTP request per item')

// ---------- Retry ----------
const sleeps: number[] = []
const sleep = async (ms: number) => { sleeps.push(ms) }
let attempts: Call[] = []
r = await executeWorkflowDAG(wf([n('t', 'trigger'), http({ url: 'https://api.example.com/' }, { retries: 2, retryDelaySec: 1 })], [e('t', 'h')]), undefined, 'u', { deps: { sleep, fetcher: fetcherOf([() => reply(500, 'boom'), () => reply(503, 'boom'), () => reply(200, { ok: true })], attempts) } })
assert(r.status === 'completed' && attempts.length === 3 && sleeps.join() === '1000,2000', 'a step that fails twice then works completes, waiting 1s then 2s')
assert(/succeeded on attempt 3/.test(r.logs.find(l => l.nodeId === 'h')!.message || ''), 'the run log says how many attempts it took')
attempts = []; sleeps.length = 0
r = await executeWorkflowDAG(wf([n('t', 'trigger'), http({ url: 'https://api.example.com/' }, { retries: 3 })], [e('t', 'h')]), undefined, 'u', { deps: { sleep, fetcher: fetcherOf([() => reply(404, 'missing')], attempts) } })
assert(r.status === 'failed' && attempts.length === 1 && sleeps.length === 0, 'a setup problem (404) is not retried')
attempts = []
r = await executeWorkflowDAG(wf([n('t', 'trigger'), http({ url: 'https://api.example.com/' }, { retries: 99 })], [e('t', 'h')]), undefined, 'u', { deps: { sleep, fetcher: fetcherOf([() => reply(500, 'boom')], attempts) } })
assert(r.status === 'failed' && attempts.length === 4 && /after 4 attempts/.test(r.logs.find(l => l.nodeId === 'h')!.message || ''), 'retries are capped at 3 (4 attempts in all)')
attempts = []
r = await executeWorkflowDAG(wf([n('t', 'trigger'), n('x', 'logic', { subtype: 'code', code: 'throw new Error("mine")', settings: { retries: 3 } })], [e('t', 'x')]), undefined, 'u', { deps: { sleep } })
assert(r.status === 'failed', 'a code step that throws fails without being retried')
attempts = []
r = await executeWorkflowDAG(wf([n('t', 'trigger'), loopNode({ items: 'trigger.payload.list', settings: { retries: 3 }, body: { kind: 'http', config: { url: 'https://api.example.com/' } } })].map(x => x.id === 'loop' ? { ...x, data: { ...x.data, settings: { retries: 3 } } } : x), [e('t', 'loop')]), { payload: { list: [1] } }, 'u', { deps: { sleep, fetcher: fetcherOf([() => reply(500, 'boom')], attempts) } })
assert(attempts.length === 1, 'a loop is never retried as a whole')

// ---------- Error path ----------
const branch = (settings: any, edges: any[], extra: any[] = []) => wf(
  [n('t', 'trigger'), http({ url: 'https://api.example.com/' }, settings), n('ok', 'logic', { subtype: 'set', config: { fields: [{ key: 'v', value: 'fine' }] } }), n('err', 'logic', { subtype: 'set', config: { fields: [{ key: 'why', value: 'broke: {{h.error}}' }] } }), ...extra],
  edges)
const failingFetch = () => ({ sleep, fetcher: fetcherOf([() => reply(500, 'down')]) })
const okFetch = () => ({ sleep, fetcher: fetcherOf([() => reply(200, { fine: true })]) })
const states = (res: any) => Object.fromEntries(res.logs.map((l: any) => [l.nodeId, l.status]))

r = await executeWorkflowDAG(branch({ onError: 'route' }, [e('t', 'h'), e('h', 'ok'), e('h', 'err', 'error')]), undefined, 'u', { deps: failingFetch() })
assert(r.status === 'completed' && states(r).h === 'failed' && states(r).err === 'completed' && states(r).ok === 'skipped' && /broke: .*500/.test(r.outputs.err.why), 'onError route: the error path runs, the normal path is skipped, and the run still counts as completed')
r = await executeWorkflowDAG(branch({ onError: 'route' }, [e('t', 'h'), e('h', 'ok'), e('h', 'err', 'error')]), undefined, 'u', { deps: okFetch() })
assert(r.status === 'completed' && states(r).ok === 'completed' && states(r).err === 'skipped', 'when the step works, the error path stays idle')
r = await executeWorkflowDAG(branch({ onError: 'route' }, [e('t', 'h'), e('h', 'ok')]), undefined, 'u', { deps: failingFetch() })
assert(r.status === 'failed' && states(r).ok === 'skipped', 'onError route with no error connection drawn behaves like stop')
r = await executeWorkflowDAG(branch({ onError: 'continue' }, [e('t', 'h'), e('h', 'err')]), undefined, 'u', { deps: failingFetch() })
assert(r.status === 'completed' && states(r).err === 'completed' && /broke/.test(r.outputs.err.why) && /Failed, continuing/.test(r.logs.find(l => l.nodeId === 'h')!.message || ''), 'onError continue: later steps run and can read {{step.error}}')
r = await executeWorkflowDAG(branch(undefined, [e('t', 'h'), e('h', 'ok'), e('h', 'err', 'error')]), undefined, 'u', { deps: failingFetch() })
assert(r.status === 'failed' && states(r).ok === 'skipped' && states(r).err === 'skipped', 'by default a failure stops the run and the error path is not taken')
r = await executeWorkflowDAG(branch({ onError: 'route', retries: 1, retryDelaySec: 1 }, [e('t', 'h'), e('h', 'err', 'error')]), undefined, 'u', { deps: failingFetch() })
assert(r.outputs.h.attempts === 2 && r.status === 'completed', 'retries happen first, then the error path')

// ---------- Outbound limit ----------
let spent = 0
try { for (let i = 0; i < 300; i++) { spendOutbound('limit-user'); spent++ } } catch { /* not expected */ }
assert(spent === 300 && await rejects(async () => spendOutbound('limit-user'), NodeConfigError) && !(await rejects(async () => spendOutbound('another-user'))), 'a user can send 300 workflow web requests per 10 minutes, then is told to wait; others are unaffected')
