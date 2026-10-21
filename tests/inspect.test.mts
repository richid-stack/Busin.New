import { finishInspection, judgeScreenshot, describeProgress } from '../server/services/inspect/judge'
import { InspectError, LIMITS, captureScreenshot, checkTarget } from '../server/services/inspect/browser'
import type { BrowserLike, RouteLike } from '../server/services/inspect/browser'
import { defaultProvider, remoteProvider } from '../server/services/inspect/screenshot'
import { runInspection } from '../server/services/inspect/inspect'
import { runVisualCheckNode } from '../server/utils/workflowVisual'
import { NodeConfigError } from '../server/utils/workflowNodes'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as Error } return null }

const d = (severity: 'blocker' | 'major' | 'minor', problem = 'x') => ({ severity, area: 'header', problem, fix: 'fix it' })
const raw = (over: Record<string, any> = {}) => ({ verdict: 'pass' as const, score: 90, summary: 'ok', defects: [] as any[], previous: [] as any[], ...over })

// ---- The judge's answer is made consistent ----
let r = finishInspection(raw({ defects: [d('minor', 'a'), d('blocker', 'b'), d('major', 'c')] }))
assert(r.verdict === 'fail' && r.defects.map(x => x.severity).join() === 'blocker,major,minor' && r.defects.map(x => x.id).join() === 'd1,d2,d3', 'a pass with a blocker or major defect becomes a fail, and defects are ordered and renumbered')
assert(r.counts.blocker === 1 && r.counts.major === 1 && r.counts.minor === 1, 'defects are counted by severity')
assert(finishInspection(raw({ verdict: 'fail' })).verdict === 'unsure', 'a fail with nothing listed is "unsure"')
assert(finishInspection(raw({ defects: [d('minor')] })).verdict === 'pass', 'minor polish alone can still pass')
r = finishInspection(raw({ previous: [{ id: 'd1', status: 'fixed', note: 'gone' }] }), [{ id: 'd1', problem: 'p' }, { id: 'd2', problem: 'q' }])
assert(r.progress.length === 2 && r.progress[0]!.status === 'fixed' && r.progress[1]!.status === 'unclear', 'an earlier defect the review did not mention is "unclear", never "fixed"')
assert(describeProgress(r) === '1 of 2 earlier defects fixed, 0 still there, 1 unclear.' && describeProgress(finishInspection(raw())) === '', 'progress is described for people, and empty with nothing to compare')

// ---- The judge sends the picture and the earlier defects to the model ----
let seen: any
const fakeGenerate = (async (args: any) => { seen = args; return { object: raw({ defects: [d('major')] }) } }) as any
const judged = await judgeScreenshot({ image: { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }, requirements: 'Big blue button', previous: [{ id: 'd1', area: 'hero', problem: 'button is grey' }], context: 'https://example.com' }, { model: {} as any, generate: fakeGenerate })
const content = seen.messages[0].content
assert(content.some((p: any) => p.type === 'image' && p.mediaType === 'image/png') && content.find((p: any) => p.type === 'text').text.includes('d1 [hero]: button is grey'), 'the model gets the picture, the requirements and the earlier defects')
assert(/never instructions/i.test(seen.system) && judged.verdict === 'fail', 'text inside the screenshot is treated as content, not instructions')

// ---- Addresses ----
const bad = (u: string, local = false) => { try { checkTarget(u, local); return false } catch (e) { return e instanceof InspectError } }
assert(bad('http://localhost:3000') && bad('http://127.0.0.1') && bad('http://169.254.169.254/') && bad('file:///etc/passwd') && bad('nonsense'), 'private, local and non-web addresses are refused')
assert(!bad('http://localhost:3000', true) && bad('http://10.0.0.1', true) && bad('http://user:pw@localhost/', true), 'development mode allows localhost only, nothing else private')
assert(!bad('https://93.184.216.34/page'), 'a public address is accepted')

// ---- The browser: every request the page makes is checked ----
function fakeBrowser(requests: string[], opts: { gotoError?: string, fullHeight?: number } = {}) {
  const log: Record<string, any> = { shots: [], closed: 0, contexts: 0, viewport: null, results: [] as string[] }
  const browser: BrowserLike = {
    async newContext(options) {
      log.contexts++
      log.viewport = options.viewport
      let handler: ((route: RouteLike) => Promise<void>) | null = null
      return {
        async route(_p, h) { handler = h },
        async newPage() {
          return {
            async goto(url) {
              if (opts.gotoError) throw new Error(opts.gotoError)
              for (const u of requests) await handler!({ request: () => ({ url: () => u }), continue: async () => { log.results.push(`ok ${u}`) }, abort: async () => { log.results.push(`blocked ${u}`) } })
              return url
            },
            async title() { return 'Demo' },
            url() { return 'https://93.184.216.34/' },
            async waitForTimeout() {},
            async evaluate<T>() { return (opts.fullHeight ?? 700) as T },
            async screenshot(o) { log.shots.push(o); return new Uint8Array([9, 9]) }
          }
        },
        async close() {}
      }
    },
    async close() { log.closed++ }
  }
  return { browser, log }
}
{
  const { browser, log } = fakeBrowser(['https://93.184.216.34/app.js', 'http://169.254.169.254/latest', 'http://127.0.0.1:9/x', 'data:image/png;base64,AAAA'])
  const shot = await captureScreenshot({ url: 'https://93.184.216.34/', width: 100000, height: 10 }, { launch: async () => browser })
  assert(log.results.join('|') === 'ok https://93.184.216.34/app.js|blocked http://169.254.169.254/latest|blocked http://127.0.0.1:9/x|ok data:image/png;base64,AAAA', 'requests to private addresses are blocked, public ones and inline data are allowed')
  assert(log.viewport.width === LIMITS.maxWidth && log.viewport.height === LIMITS.minSize, 'the window size is kept within limits')
  assert(shot.bytes.length === 2 && shot.mediaType === 'image/jpeg' && shot.title === 'Demo' && log.closed === 1, 'a screenshot comes back and the browser is closed')
}
{
  const { browser, log } = fakeBrowser(Array.from({ length: LIMITS.maxRequests + 3 }, () => 'https://93.184.216.34/a.png'))
  await captureScreenshot({ url: 'https://93.184.216.34/' }, { launch: async () => browser })
  assert(log.results.filter((x: string) => x.startsWith('blocked')).length === 3, 'a page that makes endless requests is cut off at the limit')
}
{
  const { browser, log } = fakeBrowser([], { fullHeight: 90000 })
  await captureScreenshot({ url: 'https://93.184.216.34/', fullPage: true }, { launch: async () => browser })
  assert(log.shots[0].fullPage === true && log.shots[0].clip.height === LIMITS.maxFullPageHeight, 'a very tall page is cut at the height limit')
}
{
  const { browser, log } = fakeBrowser([], { gotoError: 'Timeout 25000ms exceeded' })
  const e = await rejects(() => captureScreenshot({ url: 'https://93.184.216.34/' }, { launch: async () => browser }))
  assert(e instanceof InspectError && /too long/.test(e.message) && log.closed === 1, 'a slow page gives a plain message and still closes the browser')
  assert(await rejects(() => captureScreenshot({ url: 'http://localhost/' }, { launch: async () => { throw new Error('must not launch') } })) instanceof InspectError, 'an unsafe address is refused before a browser starts')
}

// ---- The remote worker client ----
const okBody = { imageBase64: Buffer.from([1, 2, 3]).toString('base64'), width: 1280, height: 800, url: 'https://93.184.216.34/', title: 'T' }
const fakeFetch = (status: number, body: unknown, calls: any[] = []) => (async (url: any, init: any) => { calls.push({ url, init }); return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }) }) as any
{
  const calls: any[] = []
  const p = remoteProvider({ url: 'https://worker.example/', secret: 's'.repeat(30), fetch: fakeFetch(200, okBody, calls) })
  const shot = await p.capture({ url: 'https://93.184.216.34/' })
  assert(calls[0].url === 'https://worker.example/screenshot' && calls[0].init.headers.Authorization === `Bearer ${'s'.repeat(30)}` && calls[0].init.redirect === 'error', 'the worker is called with the secret and no redirects')
  assert(shot.bytes.length === 3 && shot.title === 'T', 'the picture is read from the worker response')
  assert(await rejects(() => p.capture({ url: 'http://169.254.169.254/' })) instanceof InspectError && calls.length === 1, 'an unsafe address never leaves the app')
  const e400 = await rejects(() => remoteProvider({ url: 'https://w', secret: 'x', fetch: fakeFetch(400, { error: 'The page took too long to load.' }) }).capture({ url: 'https://93.184.216.34/' }))
  assert(e400?.message === 'The page took too long to load.', 'the worker\'s own 400 message is shown')
  const e500 = await rejects(() => remoteProvider({ url: 'https://w', secret: 'x', fetch: fakeFetch(500, { error: 'stack trace /srv/app' }) }).capture({ url: 'https://93.184.216.34/' }))
  assert(e500 instanceof InspectError && !/stack|srv/.test(e500.message), 'other worker errors are not shown')
  const eBig = await rejects(() => remoteProvider({ url: 'https://w', secret: 'x', fetch: fakeFetch(200, { ...okBody, imageBase64: 'A'.repeat(9_000_000) }) }).capture({ url: 'https://93.184.216.34/' }))
  assert(eBig instanceof InspectError, 'an oversize or unreadable answer is refused')
  const eDown = await rejects(() => remoteProvider({ url: 'https://w', secret: 'x', fetch: (async () => { throw new Error('ECONNREFUSED') }) as any }).capture({ url: 'https://93.184.216.34/' }))
  assert(eDown instanceof InspectError && /could not be reached/.test(eDown.message), 'a worker that is down gives a retryable message')
}
assert(defaultProvider({}) === null && defaultProvider({ INSPECTOR_URL: 'https://w' }) === null, 'with no worker configured there is no provider')
assert(defaultProvider({ INSPECTOR_URL: 'https://w', INSPECTOR_SECRET: 'x'.repeat(30) }) !== null && defaultProvider({ INSPECTOR_LOCAL: '1', NODE_ENV: 'development' } as any) !== null, 'a worker, or development mode, gives a provider')
assert(defaultProvider({ INSPECTOR_LOCAL: '1', NODE_ENV: 'production' } as any) === null, 'the in-app browser is never used in production')

// ---- runInspection: charge after the picture, refund on failure, keep a copy ----
const jpeg = { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' as const, width: 1, height: 1, url: 'https://93.184.216.34/', title: '' }
const provider = { capture: async () => jpeg }
const model = { id: 'google/test', model: {} as any }
const judgeOk = async () => finishInspection(raw({ defects: [d('minor')] }))
function charger() { const s = { charged: 0, refunded: 0 }; return { s, charge: async (_u: string, c: number) => { s.charged += c; return { refund: async () => { s.refunded += c } } } } }
{
  const c = charger(); const saved: any[] = []
  const out = await runInspection({ userId: 'u', requirements: 'Looks clean and modern', url: 'https://93.184.216.34/' }, { provider, model, judge: judgeOk, charge: c.charge as any, save: async (i) => { saved.push(i); return { id: 'file1' } } })
  assert(out.verdict === 'pass' && out.screenshotFileId === 'file1' && saved[0].mime === 'image/jpeg' && c.s.charged > 0 && c.s.refunded === 0 && out.source === 'https://93.184.216.34/', 'a look is charged once, saved, and reported')
}
{
  const c = charger()
  const e = await rejects(() => runInspection({ userId: 'u', requirements: 'Looks clean and modern', url: 'https://93.184.216.34/' }, { provider, model, judge: async () => { throw new Error('model down') }, charge: c.charge as any }))
  assert(e instanceof InspectError && c.s.charged === c.s.refunded && c.s.charged > 0, 'a failed look is refunded')
  const c2 = charger()
  await rejects(() => runInspection({ userId: 'u', requirements: 'Looks clean and modern', url: 'https://93.184.216.34/' }, { provider: { capture: async () => { throw new InspectError('The page took too long to load.') } }, model, judge: judgeOk, charge: c2.charge as any }))
  assert(c2.s.charged === 0, 'a page that cannot be loaded costs nothing')
}
assert(await rejects(() => runInspection({ userId: 'u', requirements: 'short', url: 'https://93.184.216.34/' }, { provider, model })) instanceof InspectError, 'requirements are required')
assert(await rejects(() => runInspection({ userId: 'u', requirements: 'Looks clean and modern' }, { provider, model })) instanceof InspectError, 'an address or a picture is required')
assert(/not set up/.test((await rejects(() => runInspection({ userId: 'u', requirements: 'Looks clean and modern', url: 'https://93.184.216.34/' }, { provider: null, model })))?.message ?? ''), 'no worker gives a clear message and suggests attaching a screenshot')
assert(/can look at pictures/.test((await rejects(() => runInspection({ userId: 'u', requirements: 'Looks clean and modern', url: 'https://93.184.216.34/' }, { provider, model: null })))?.message ?? ''), 'no vision model gives a clear message')
assert(await rejects(() => runInspection({ userId: 'u', requirements: 'Looks clean and modern', image: { bytes: new Uint8Array([1]), mediaType: 'image/svg+xml' } }, { provider, model })) instanceof InspectError, 'only real picture types are accepted')
{
  const out = await runInspection({ userId: 'u', requirements: 'Looks clean and modern', image: { bytes: new Uint8Array([1]), mediaType: 'image/png', name: 'home.png' } }, { provider: null, model, judge: judgeOk, charge: charger().charge as any })
  assert(out.source === 'home.png' && out.screenshotFileId === null, 'an attached picture is judged without a worker')
}

// ---- The workflow step ----
const stepDeps = (extra: Record<string, any> = {}) => ({ provider, model, judge: judgeOk, charge: charger().charge as any, save: async () => ({ id: 'f9' }), ...extra })
{
  const out = await runVisualCheckNode({ url: '{{trigger.site}}', requirements: 'Clear headline and a main button' }, { trigger: { site: 'https://93.184.216.34/' } }, 'u', undefined, stepDeps())
  assert(out.passed === true && out.verdict === 'pass' && out.defectCount === 1 && out.screenshotFileId === 'f9', 'the step outputs pass/fail, defects and the screenshot')
}
{
  let sawPrevious: any
  const judge = async (input: any) => { sawPrevious = input.previous; return finishInspection(raw({ verdict: 'fail', defects: [d('major')] }), input.previous) }
  const out = await runVisualCheckNode({ url: 'https://93.184.216.34/', requirements: 'Clear headline and a main button', previous: '{{check.defects}}' }, { check: { defects: [{ id: 'd1', problem: 'grey button', area: 'hero' }, { nope: true }] } }, 'u', undefined, stepDeps({ judge }))
  assert(out.passed === false && sawPrevious.length === 1 && sawPrevious[0].id === 'd1', 'a failing verdict is data for later steps, and earlier defects are passed on for a re-check')
}
const cfgErr = async (config: any, inputs: any = {}, deps: any = stepDeps()) => (await rejects(() => runVisualCheckNode(config, inputs, 'u', undefined, deps))) instanceof NodeConfigError
assert(await cfgErr({ url: '', requirements: 'Clear headline and a main button' }), 'a missing address is a setup error')
assert(await cfgErr({ url: 'https://93.184.216.34/', requirements: 'short' }), 'missing requirements are a setup error')
assert(await cfgErr({ url: 'https://93.184.216.34/', requirements: 'Clear headline and a main button', previous: '{{x.notalist}}' }, { x: { notalist: 'text' } }), 'earlier defects that are not a list are a setup error')
assert(await cfgErr({ url: 'http://169.254.169.254/', requirements: 'Clear headline and a main button' }, {}, stepDeps({ provider: { capture: async (r: any) => checkTarget(r.url) as any } })), 'an unsafe address is a setup error and is not retried')
{
  const e = await rejects(() => runVisualCheckNode({ url: 'https://93.184.216.34/', requirements: 'Clear headline and a main button' }, {}, 'u', undefined, stepDeps({ provider: { capture: async () => { throw new InspectError('The screenshot service could not be reached. Try again in a moment.') } } })))
  assert(e instanceof InspectError && !(e instanceof NodeConfigError), 'a service that is briefly down can be retried')
}

// ---- The worker refuses to run without a real secret ----
const worker = await import('node:child_process').then(m => m.spawnSync('npx', ['tsx', 'inspector/server.ts'], { env: { ...process.env, INSPECTOR_SECRET: 'short', PORT: '0' }, encoding: 'utf8', timeout: 30000 }))
assert(worker.status !== 0 && /INSPECTOR_SECRET/.test(`${worker.stderr}${worker.stdout}`), 'the screenshot worker will not start without a long secret')
