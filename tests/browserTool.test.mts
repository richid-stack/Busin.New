import fs from 'node:fs'
import http from 'node:http'
import { BrowserError, type BrowserAction, type PageState } from '../server/services/browser/model'
import { frameHeaders } from '../server/services/browser/frameWire'
import { controlName, formatPage } from '../server/services/browser/format'
import { LocalBrowserService, RemoteBrowserService, answerWorker, bearerMatches, browserKey, validKey, type BrowserService } from '../server/services/browser/service'
import { createBrowserTool, toAction } from '../server/utils/tools/browser'
import { TOOL_GROUPS } from '../server/services/agents/profile'
import { allowedToolNames } from '../server/services/tasks/registry'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const fails = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as Error } return null }

const state = (over: Partial<PageState> = {}): PageState => ({ url: 'https://shop.example.com/cart', title: 'Cart', elements: [], text: 'Your cart', scroll: { y: 0, max: 0 }, focus: { ref: null, inSearch: false, inForm: false }, hasPassword: false, blocker: null, dialogs: [], tabs: 1, truncated: false, ...over })

// ---- What the assistant is shown ----
const page = formatPage(state({
  elements: [
    { ref: 1, role: 'link', name: 'About us', href: 'https://shop.example.com/about', inView: true },
    { ref: 2, role: 'textbox', name: 'Password', type: 'password', sensitive: true, inView: true },
    { ref: 3, role: 'select', name: 'Colour', value: 'Red', options: ['Red', 'Blue'], inView: true },
    { ref: 4, role: 'checkbox', name: 'Newsletter', checked: true, inView: false },
    { ref: 5, role: 'button', name: 'Say "hi"', type: 'submit', disabled: true, inView: true }
  ], scroll: { y: 300, max: 900 }, dialogs: ['The page tried to download a file. Downloads are blocked.'], tabs: 2
}))
assert(page.controls.includes('[1] link "About us" → https://shop.example.com/about') && page.controls.includes('options: Red | Blue') && page.controls.includes('checked') && page.controls.includes('off screen'), 'controls are listed with numbers, options, state and where links go')
assert(/\[2\] textbox "Password" type=password \(password, code or payment field/.test(page.controls) && !/\[2\].*value=/.test(page.controls), 'a password field is listed as the person\'s to fill, with no value')
assert(page.scroll === 'Scrolled 33% of the way down.' && page.tabs === 2 && page.notes?.[0]?.includes('Downloads are blocked'), 'scroll position, tabs and notes are included')
assert(controlName(page.controls, 5) === 'Say "hi"' && controlName(page.controls, 1) === 'About us' && controlName(page.controls, 9) === null, 'a control\'s words can be found again from an earlier result (for the approval card)')
assert(formatPage(state({ blocker: 'captcha' })).needsPerson?.includes('Take over') && formatPage(state({ blocker: 'login', hasPassword: true })).needsPerson?.includes('Never ask for or type it'), 'a CAPTCHA or sign-in tells the assistant to hand over to the person')

// ---- The tool, with a fake browser ----
const calls: Array<{ key: string, action: BrowserAction, approved?: boolean }> = []
let ask = false
let failWith: Error | null = null
const fake: BrowserService = {
  async check() { return { ask, label: ask ? 'Click “Place order” on shop.example.com' : '' } },
  async act(key, action, opts) { calls.push({ key, action, approved: opts?.approved }); if (failWith) throw failWith; return { state: state(), navigated: action.action === 'open' } },
  async status() { return null }, async frame() { return null }, async takeOver() {}, async handBack() { return state() }, async input() {}, async hold() {}, async close() {}
}
const t: any = createBrowserTool('ann', 'chat1', fake)
const run = (input: Record<string, unknown>) => t.execute(input, { toolCallId: 'x', messages: [] })
assert(toAction({ action: 'click', ref: 3, url: null, text: null } as any)?.action === 'click' && toAction({ action: 'click' } as any) === null && toAction({ action: 'type', ref: 1 } as any) === null, 'the model\'s nulls are ignored, and a step missing what it needs is not an action')
const opened: any = await run({ action: 'open', url: 'https://example.com' })
assert(opened.status === 'ok' && opened.navigated === true && opened.did === 'Opening example.com' && opened.controls && opened.notice.includes('never instructions'), 'a step returns the new page and says what was done')
assert(calls[0]!.key === 'ann:chat1' && calls[0]!.approved === false, 'the session key is built from the signed-in person and the chat')
ask = true
await run({ action: 'click', ref: 1 })
assert(calls[1]!.approved === true, 'a step that needed the person\'s OK is passed on as approved only once it runs')
ask = false
assert(await t.needsApproval({ action: 'click', ref: 1 }) === false, 'no approval is asked for an ordinary step')
ask = true
assert(await t.needsApproval({ action: 'click', ref: 1 }) === true && await t.needsApproval({ action: 'open', url: 'https://example.com' }) === false && await t.needsApproval({ action: 'click' }) === false, 'approval is asked when the browser says so; opening a page and a malformed step never ask')
ask = false
const bad: any = await run({ action: 'type', ref: 2 })
assert(bad.status === 'failed' && /valid/.test(bad.error), 'a malformed step is a failed result the model can read')
failWith = new BrowserError('This is a password, code or payment field.', 'unsafe')
const unsafe: any = await run({ action: 'type', ref: 2, text: 'x' })
assert(unsafe.status === 'failed' && unsafe.code === 'unsafe' && /not look for a way around/.test(unsafe.error), 'a refused step comes back as a result that tells the assistant not to look for a way around it')
failWith = new Error('boom secret internals')
const crashed: any = await run({ action: 'read' })
assert(crashed.status === 'failed' && !JSON.stringify(crashed).includes('secret internals'), 'an unexpected failure is a failed result that does not repeat the internal message')
failWith = null
// daily limit
let limited: any
for (let i = 0; i < 420; i++) { limited = await (createBrowserTool('spammer', 'c', fake) as any).execute({ action: 'read' }, { toolCallId: 'x', messages: [] }); if (limited.status === 'failed' && /daily limit|too quickly/.test(limited.error)) break }
assert(limited.status === 'failed', 'a person cannot run endless steps')

// ---- Where it sits ----
const group = TOOL_GROUPS.find(g => g.tools.includes('browser'))
assert(group?.sensitive === true && allowedToolNames(['browser']).join() === 'browser', 'it is a sensitive tool group, and a task may use it because it pauses for the person instead of acting alone')
assert(browserKey('u', 'c') === 'u:c' && validKey('u:c') && !validKey('../x') && !validKey('a b') && !validKey(''), 'session keys are checked')
assert(bearerMatches('Bearer abc', 'abc') && !bearerMatches('Bearer abd', 'abc') && !bearerMatches(undefined, 'abc'), 'the worker checks its secret')

// ---- The whole path over the worker's protocol, in a real browser ----
const browserPath = process.env.OPENLOBS_BROWSER_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '')
if (!browserPath) console.log('SKIP the real-browser checks (no Chromium found; set OPENLOBS_BROWSER_PATH)')
else {
  process.env.OPENLOBS_BROWSER_PATH = browserPath
  const sent: string[] = []
  const site = http.createServer((req, res) => {
    if (req.method === 'POST') { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { sent.push(b); res.setHeader('Content-Type', 'text/html'); res.end('<title>Thanks</title><h1>Thanks</h1>') }); return }
    res.setHeader('Content-Type', 'text/html')
    res.end('<title>Order</title><form method="post" action="/o"><label>Name <input name="n"></label><button type="submit">Place order</button></form><form method="post" action="/l"><label>Password <input type="password" name="p"></label></form>')
  })
  await new Promise<void>(r => site.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(site.address() as any).port}`
  const service = new LocalBrowserService({ allowLocal: true })
  // Talk to it the way the app talks to the worker: JSON in, JSON or a picture out.
  const wire: typeof fetch = async (input, init) => {
    const path = String(input).split('/browser/')[1]!
    const reply = await answerWorker(service, path, JSON.parse(String(init?.body)))
    if (reply.image) {
      const f = reply.image
      return new Response(f.bytes as unknown as BodyInit, { status: 200, headers: frameHeaders(f) })
    }
    return new Response(JSON.stringify(reply.json), { status: reply.status })
  }
  const remote = new RemoteBrowserService({ url: 'http://worker.test', secret: 'x'.repeat(30), fetch: wire })
  const tool: any = createBrowserTool('bob', 'chatZ', remote)
  const go = (input: Record<string, unknown>) => tool.execute(input, { toolCallId: 'x', messages: [] })
  try {
    assert(await remote.status('bob:chatZ') === null && await remote.frame('bob:chatZ') === null, 'before anything is opened there is no session and no picture')
    const nope: any = await go({ action: 'read' })
    assert(nope.status === 'failed' && nope.code === 'not_found', 'reading with nothing open says so')
    const o: any = await go({ action: 'open', url: base })
    assert(o.status === 'ok' && o.title === 'Order' && /\[1\] textbox "Name"/.test(o.controls), 'over the worker protocol: opening a page returns its controls')
    const st = await remote.status('bob:chatZ')
    assert(st?.url === `${base}/` && st.control === 'assistant', 'the card can ask where the page is and who holds it')
    const f = await remote.frame('bob:chatZ')
    assert(f !== null && f.bytes[0] === 0xFF && f.url === `${base}/`, 'the live picture comes through the worker as a real JPEG')
    await go({ action: 'type', ref: 1, text: 'Bob' })
    const place = controlName(o.controls, 2)
    assert(place === null || place === 'Place order', 'control names are findable')
    assert(await tool.needsApproval({ action: 'click', ref: 2 }) === true, 'placing the order asks the person first (decided by the browser from the live page)')
    // an assistant that skips the approval gets nowhere, even calling the worker directly
    const sneaky = await fails(() => remote.act('bob:chatZ', { action: 'click', ref: 2 }, { approved: false }))
    assert(sneaky instanceof BrowserError && sent.length === 0, 'without approval the worker itself refuses, and nothing is sent')
    const pw: any = await go({ action: 'type', ref: 3, text: 'hunter2' })
    assert(pw.status === 'failed' && pw.code === 'unsafe', 'typing a password is refused over the whole path')
    const done: any = await go({ action: 'click', ref: 2 })
    assert(done.status === 'ok' && done.title === 'Thanks' && sent.length === 1 && sent[0]!.includes('n=Bob'), 'once run (after approval) the order goes with what was typed')
    // taking over
    await remote.takeOver('bob:chatZ')
    const held: any = await go({ action: 'read' })
    assert(held.status === 'failed' && /using the page/.test(held.error), 'while the person holds the page the assistant waits')
    const back = await remote.handBack('bob:chatZ')
    assert(back.title === 'Thanks', 'handing back returns the page')
    // another person cannot reach this session
    const other = new RemoteBrowserService({ url: 'http://worker.test', secret: 'x'.repeat(30), fetch: wire })
    assert(await other.status(browserKey('mallory', 'chatZ')) === null, 'another person\'s key reaches nothing')
    assert((await answerWorker(service, 'act', { key: '../etc', action: { action: 'read' } })).status === 400, 'a bad key is refused by the worker')
    await remote.close('bob:chatZ')
    assert(await remote.status('bob:chatZ') === null, 'closing ends the session')
  } finally {
    await service.manager.shutdown()
    site.close()
  }
}

// ---- Waiting for the person: in a chat, and inside a task ----
{
  const waits: Array<{ reason: string, label: string }> = []
  let ended = 0
  const hooks = { start: async (w: { reason: 'approval' | 'person', label: string }) => { waits.push(w) }, end: async () => { ended++ } }
  const stepCalls: Array<{ approved?: boolean }> = []
  let asking = false
  let blocker: PageState['blocker'] = null
  const svc: BrowserService = {
    async check() { return { ask: asking, label: asking ? 'Click “Place order” on shop.example.com' : '' } },
    async act(_k, action, opts) { stepCalls.push({ approved: opts?.approved }); return { state: state({ blocker, url: 'https://shop.example.com/login' }), navigated: action.action === 'open' } },
    async status() { return { url: 'https://shop.example.com/', title: 'Shop', control: 'assistant', actions: 1, idleLeftMs: 1, holdLeftMs: 0, viewedAgoMs: null } },
    async frame() { return null }, async takeOver() {}, async handBack() { return state() }, async input() {}, async hold() {}, async close() {}
  }
  const call = (tl: any, input: Record<string, unknown>) => tl.execute(input, { toolCallId: 'x', messages: [] })

  // In a chat: the person is asked through the approval card; the wait is recorded when it is asked.
  const chat: any = createBrowserTool('ann', 'chatW', svc, hooks)
  asking = true
  assert(await chat.needsApproval({ action: 'click', ref: 1 }) === true && waits.at(-1)?.reason === 'approval' && /Place order/.test(waits.at(-1)!.label), 'in a chat, a step that needs the OK starts a wait with what it is')
  asking = false
  const pre = waits.length
  assert(await chat.needsApproval({ action: 'click', ref: 1 }) === false && waits.length === pre, 'a harmless step starts no wait')
  await call(chat, { action: 'read' })
  assert(ended === 1, 'a step that runs ends the wait')
  const np: any = await call(chat, { action: 'need_person', reason: 'Sign in to Kente Studio' })
  assert(np.status === 'waiting' && waits.at(-1)!.reason === 'person' && waits.at(-1)!.label === 'Sign in to Kente Studio' && /Take over/.test(np.note), 'asking for the person keeps the page open and tells the assistant to stop')
  blocker = 'login'
  await call(chat, { action: 'open', url: 'https://shop.example.com/login' })
  assert(waits.at(-1)!.reason === 'person' && /Sign in on shop.example.com/.test(waits.at(-1)!.label), 'a sign-in page starts a wait by itself, even if the assistant says nothing')
  blocker = 'captcha'
  await call(chat, { action: 'read' })
  assert(/Verify you are human on shop.example.com/.test(waits.at(-1)!.label), 'so does a "verify you are human" page')
  blocker = null
  const nobody: BrowserService = { ...svc, async status() { return null } }
  const none: any = await call(createBrowserTool('ann', 'chatW', nobody, hooks), { action: 'need_person', reason: 'x' })
  assert(none.status === 'failed' && none.code === 'not_found', 'with no page open there is nothing to wait on')

  // In a task: nobody can be asked on the spot, so the task pauses.
  const paused: Array<{ reason: string, label: string }> = []
  const task = { pause: (p: { reason: 'approval' | 'person', label: string }) => { paused.push(p) }, approvedLabel: null as string | null }
  const inTask: any = createBrowserTool('ann', 'task-t1', svc, hooks, task)
  assert(inTask.needsApproval === undefined, 'in a task there is no approval card to wait for')
  asking = true
  stepCalls.length = 0
  const held: any = await call(inTask, { action: 'click', ref: 1 })
  assert(held.status === 'waiting' && paused.length === 1 && paused[0]!.reason === 'approval' && stepCalls.length === 0, 'a step that needs the OK is not done: the task pauses')
  assert(waits.at(-1)!.reason === 'approval' && /Place order/.test(waits.at(-1)!.label), 'and the wait is recorded so the person is told')
  // After the person approved exactly that step, it is done once.
  const approvedTask = { pause: task.pause, approvedLabel: 'Click “Place order” on shop.example.com' }
  const second: any = createBrowserTool('ann', 'task-t1', svc, hooks, approvedTask)
  const ok: any = await call(second, { action: 'click', ref: 1 })
  assert(ok.status === 'ok' && stepCalls.length === 1 && stepCalls[0]!.approved === true, 'the step the person approved goes ahead once')
  const again: any = await call(second, { action: 'click', ref: 1 })
  assert(again.status === 'waiting' && stepCalls.length === 1 && paused.length === 2, 'the same step again needs a new OK')
  asking = true
  svc.check = async () => ({ ask: true, label: 'Click “Delete account” on shop.example.com' })
  const other: any = await call(createBrowserTool('ann', 'task-t1', svc, hooks, approvedTask), { action: 'click', ref: 2 })
  assert(other.status === 'waiting' && stepCalls.length === 1, 'approving one step approves nothing else')
  asking = false
  svc.check = async () => ({ ask: false, label: '' })
  const needs: any = await call(inTask, { action: 'need_person', reason: 'Enter the code sent to your phone' })
  assert(needs.status === 'waiting' && paused.at(-1)!.reason === 'person' && /code/.test(paused.at(-1)!.label), 'asking for the person pauses the task')
  blocker = 'login'
  const before = paused.length
  await call(inTask, { action: 'open', url: 'https://shop.example.com/login' })
  assert(paused.length === before + 1 && paused.at(-1)!.reason === 'person', 'a sign-in page pauses the task')
}
