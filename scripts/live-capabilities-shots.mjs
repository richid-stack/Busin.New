/**
 * Opens the real app in a real browser (Google's local test emulators for sign-in and data, no real accounts), asks real models to do
 * the things we had not tried for real, and takes screenshots with the trace closed and open: a photo search, a many-file build with the
 * preview, a workflow built and run, a task proposed and started, an agent proposed and saved.
 * When a model hits its limit the next one is used at once (Gemini first, then Groq).
 *
 *   firebase emulators:exec --only auth,firestore --project demo-openlobs "node scripts/live-capabilities-shots.mjs"
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const PORT = 3100
const BASE = `http://127.0.0.1:${PORT}`
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`
const OUT = process.env.SHOTS_OUT || 'shots'
const MODELS = (process.env.LIVE_MODELS || 'google/gemini-3.8-flash,google/gemini-3.5-flash,google/gemini-3.1-flash-lite,groq/gpt-oss-120b,groq/gpt-oss-20b,groq/qwen3.8-27b').split(',')
const KEYS = { google: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY' }
const usable = MODELS.filter(m => process.env[KEYS[m.split('/')[0]]])
const ONLY = (process.env.LIVE_SCENARIOS || 'photos,workflow,task').split(',')
mkdirSync(OUT, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const redact = t => String(t).replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]').replace(/gsk_[0-9A-Za-z]{20,}/g, '[key]')
const notes = []
const note = (m) => { notes.push(m); console.log(m) }
const problems = []
const check = (ok, what) => { note(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) problems.push(what) }

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  env: { ...process.env, LIVE_DEBUG: '1', GOOGLE_CLOUD_PROJECT: 'demo-openlobs', NODE_ENV: 'development', VITE_AUTH_EMULATOR_URL: AUTH, VITE_FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080' },
  stdio: ['ignore', 'pipe', 'pipe'], detached: true
})
let serverLog = ''
for (const s of [server.stdout, server.stderr]) s.on('data', d => { serverLog += d.toString(); if (serverLog.length > 300_000) serverLog = serverLog.slice(-150_000) })
const stop = () => { try { process.kill(-server.pid) } catch {} }
process.on('exit', stop)
async function waitForApp() { for (let i = 0; i < 150; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.status < 500) return true } catch {} await sleep(1000) } return false }

let browser, page, token
const gone = new Set()
const api = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}) } })
const shot = async (name) => { try { await page.screenshot({ path: `${OUT}/${name}.png` }); note(`shot ${name}`) } catch (e) { note(`could not take ${name}: ${e.message}`) } }

/** A tiny real request to see whether a model has room right now. */
async function hasRoom(m) {
  const created = await api('/api/chats', { method: 'POST', body: JSON.stringify({ input: 'ping' }) })
  const chat = await created.json()
  const res = await api(`/api/chats/${chat.id}`, { method: 'POST', headers: { Accept: 'text/event-stream' }, body: JSON.stringify({ model: m, messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Reply with the single word: pong' }] }] }) })
  const raw = await res.text()
  return res.status === 200 && /pong/i.test(raw) && !/"type":"error"/.test(raw)
}
async function pickModel() {
  for (const m of usable) {
    if (gone.has(m)) continue
    if (await hasRoom(m)) return m
    note(`  ${m} has no room right now, next`)
    if (!(await hasRoom(m).catch(() => false))) gone.add(m)
  }
  return null
}

async function waitForAnswer(maxMs = 240_000) {
  const start = Date.now(); let last = -1; let stable = 0
  await sleep(4000)
  while (Date.now() - start < maxMs) {
    await sleep(2000)
    const len = await page.evaluate(() => document.body.innerText.length)
    stable = len === last ? stable + 1 : 0
    last = len
    if (stable >= 12) return true
  }
  return false
}
async function send(text) { const box = page.locator('textarea').first(); await box.click(); await box.fill(text); await page.keyboard.press('Enter') }
async function openRows() {
  let opened = 0
  const rows = page.locator('button[aria-expanded="false"]')
  for (let i = 0; i < await rows.count(); i++) {
    const b = await rows.nth(i).boundingBox().catch(() => null)
    if (!b || b.x < 280 || b.x > 700 || b.y < 50 || b.y > 860) continue
    try { await rows.nth(i).click({ timeout: 1500 }); opened++; await sleep(250) } catch {}
  }
  return opened
}
const limitText = /free allowance|rate limit|busy right now|went wrong|try again|reached its/i
const pageText = () => page.evaluate(() => document.body.innerText)

/** Runs one scenario in a fresh chat with a model that has room. Tries again with the next model if the answer is only a limit message. */
async function scenario(name, prompt, after, startUrl = BASE, finished = null) {
  if (!ONLY.includes(name)) return
  for (let attempt = 0; attempt < 3; attempt++) {
    const m = await pickModel()
    if (!m) { check(false, `[${name}] a model had room`); return }
    note(`[${name}] using ${m}`)
    await page.evaluate(model => { try { localStorage.setItem('model', model) } catch {} }, m)
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' })
    await sleep(3500)
    await send(prompt)
    await waitForAnswer()
    await sleep(2000)
    const text = await pageText()
    const rows = await page.locator('button[aria-expanded]').count()
    if (limitText.test(text.slice(-1500)) && rows < 2) { note(`[${name}] ${m} answered with a limit message, moving on`); gone.add(m); continue }
    if (finished && !finished(text)) { note(`[${name}] ${m} stopped before the real answer (probably ran out of room), moving on`); gone.add(m); continue }
    await shot(`${name}-1-closed`)
    const opened = await openRows()
    await sleep(600)
    await shot(`${name}-2-open`)
    note(`[${name}] rows opened: ${opened}`)
    note(redact(text.split('\n').filter(l => limitText.test(l)).slice(0, 3).join(' | ')))
    await after(text, m)
    return
  }
  check(false, `[${name}] a model finished it`)
}

try {
  if (!(await waitForApp())) throw new Error('The app did not start')
  const email = `caps-${Date.now()}@example.com`
  const password = 'caps-password-123'
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true, displayName: 'Richie' }) })
  token = (await r.json()).idToken
  if (!token) throw new Error('The sign-in emulator gave no token')
  for (const u of ['/src/pages/chat/%5Bid%5D.vue', '/src/pages/index.vue', '/src/pages/tasks/%5Bid%5D.vue', '/src/pages/workflows/%5Bid%5D.vue', '/src/pages/agents/index.vue', '/src/pages/workspaces/index.vue', '/src/pages/workspaces/%5Bid%5D.vue', '/src/pages/settings.vue']) { try { await fetch(`${BASE}${u}`) } catch {} }
  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark', acceptDownloads: true })
  page = await ctx.newPage()
  page.on('pageerror', e => note(`page error: ${redact(e.message).slice(0, 200)}`))
  page.on('console', m => { if (m.type() === 'error' || /\[Vue warn\]/.test(m.text())) note(`console ${m.type()}: ${redact(m.text()).slice(0, 300)}`) })
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await sleep(6000)
  await page.getByRole('button', { name: /sign in|log in|get started/i }).first().click({ timeout: 20_000 })
  await sleep(1500)
  await page.getByPlaceholder('name@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: /^sign in$/i }).last().click()
  await sleep(6000)


  /** Workspaces: the screens as a person uses them, then a real chat inside one that has to open a file to answer. */
  const openMenu = async (loc) => { await loc.focus(); await page.keyboard.press('Enter'); await sleep(700) }
  if (ONLY.includes('workspaces')) {
    try {
      await page.goto(`${BASE}/workspaces`, { waitUntil: 'domcontentloaded' }); await sleep(5000)
      await shot('ws-1-empty-list')
      // An empty workspace shows the lighthouse.
      await page.getByRole('button', { name: /new workspace/i }).first().click(); await sleep(1000)
      await page.getByPlaceholder('Name the workspace').fill('Chiddymens Music')
      await page.getByRole('button', { name: 'Create workspace' }).click(); await sleep(4500)
      check(/\/workspaces\/[^/]+$/.test(page.url()), '[workspaces] creating one opens its page')
      // The first visit to a new page can make the dev server re-bundle a library (a "504 Outdated Optimize Dep"); a reload picks it up.
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(6000)
      await shot('ws-2-empty-workspace')
      await page.goto(`${BASE}/workspaces`, { waitUntil: 'domcontentloaded' }); await sleep(3500)
      await page.getByRole('button', { name: /new workspace/i }).first().click(); await sleep(1000)
      await page.getByPlaceholder('Name the workspace').fill('Kofi Bakery')
      await page.getByPlaceholder(/Describe the client/).fill('Warm, short replies. Prices are in GHS. Never promise delivery outside Accra.')
      await page.getByPlaceholder('Name the workspace').click(); await sleep(400)
      await shot('ws-3-new-dialog')
      await page.getByRole('button', { name: 'Create workspace' }).click(); await sleep(4500)
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(6000)
      const list = await (await api('/api/workspaces')).json()
      const bakery = list.workspaces.find(w => w.name === 'Kofi Bakery')
      check(!!bakery, '[workspaces] the workspace is saved')
      // Typed text as a file.
      await openMenu(page.getByRole('button', { name: 'Add', exact: true }))
      await shot('ws-4-add-menu')
      await page.getByRole('menuitem', { name: 'Add text content' }).click(); await sleep(900)
      await page.getByPlaceholder('Payment terms').fill('Price list')
      await page.getByPlaceholder('Paste or type here').fill('Kofi Bakery price list. Sourdough loaf: GHS 38. Butter croissant: GHS 15. Delivery within Accra: GHS 12. We close at 6pm on Sundays.')
      await shot('ws-5-text-dialog')
      await page.getByRole('button', { name: 'Add', exact: true }).last().click(); await sleep(3500)
      // A public GitHub repository.
      await openMenu(page.getByRole('button', { name: 'Add', exact: true }))
      await page.getByRole('menuitem', { name: 'GitHub' }).click(); await sleep(900)
      await page.getByPlaceholder('github.com/owner/name').fill('github.com/octocat/Hello-World')
      await page.getByRole('button', { name: 'Look' }).click(); await sleep(6000)
      await page.getByText('README', { exact: false }).first().click().catch(() => {}); await sleep(600)
      await shot('ws-6-github-picker')
      await page.getByRole('button', { name: /^Add 1 file/ }).click().catch(() => {}); await sleep(6000)
      await page.getByRole('button', { name: /pin/i }).first().click().catch(() => {}); await sleep(1500)
      await shot('ws-7-filled-workspace')
      const detail = await (await api(`/api/workspaces/${bakery.id}`)).json()
      check(detail.files.length >= 1 && detail.files.some(f => f.name === 'Price list'), `[workspaces] the typed file is stored (${detail.files.map(f => f.name).join(', ')})`)
      check(detail.files.some(f => f.source === 'github'), '[workspaces] the GitHub file is stored')
      // The plus menu on the home page lists workspaces; the sidebar shows the pinned one.
      await page.goto(BASE, { waitUntil: 'domcontentloaded' }); await sleep(4500)
      await openMenu(page.locator('#home-attach-btn'))
      await page.getByRole('menuitem', { name: /^Workspace/ }).focus().catch(() => {}); await page.keyboard.press('ArrowRight'); await sleep(700)
      await shot('ws-8-plus-menu')
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
      await page.goto(`${BASE}/workspaces`, { waitUntil: 'domcontentloaded' }); await sleep(4000)
      await shot('ws-9-list-with-pinned')
      // A real chat inside it that has to open the file.
      await scenario('workspaces', 'What does a sourdough loaf cost, and what is the delivery fee? Check the workspace files, then answer in one sentence.', async (text) => {
        check(/38/.test(text) && /12/.test(text), '[workspaces] the answer has the prices from the file')
        check(/Read file|Price list/i.test(text), '[workspaces] the trace shows the file being read')
        check(/Kofi Bakery/.test(text), '[workspaces] the chat header shows its workspace')
        await openMenu(page.locator('#chat-attach-btn'))
        await page.getByRole('menuitem', { name: /^Workspace/ }).focus().catch(() => {}); await page.keyboard.press('ArrowRight'); await sleep(700)
        await shot('ws-10-chat-plus-menu')
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
        const chats = await (await api('/api/chats')).json()
        check((Array.isArray(chats) ? chats : chats.chats || []).some(c => c.workspaceId === bakery.id), '[workspaces] the chat is stored inside the workspace')
      }, `${BASE}/workspaces/${bakery.id}`, t => /GHS|38/.test(t))
    } catch (e) { check(false, `[workspaces] ${redact(e.message).slice(0, 200)}`) }
  }

  await scenario('photos', 'Find me three photos of kente cloth, save the best one to my files, look at it, and tell me in one sentence what it shows and who took it.', async (text) => {
    check(/Found photos|Found \d+ photo/i.test(text) || await page.getByText(/photos/i).count() > 0, '[photos] the trace shows the photo search')
    check(/Saved|fetch/i.test(text), '[photos] the trace shows the photo being saved')
    const imgs = await page.evaluate(async () => Promise.all([...document.images].filter(i => /^blob:/.test(i.src) && i.closest('button, [role="button"], div')).map(async (i) => { const r = await fetch(i.src).catch(() => null); const blob = r ? await r.clone().blob() : null; const bmp = blob ? await createImageBitmap(blob).then(b => `${b.width}x${b.height}`).catch(e => `cannot decode: ${e.message}`) : null; return { src: i.src.slice(-40), complete: i.complete, shownWidth: i.naturalWidth, lazy: i.loading, rect: JSON.stringify(i.getBoundingClientRect()).slice(0, 70), status: r?.status, type: r?.headers.get('content-type'), len: r?.headers.get('content-length'), got: blob?.size, decodes: bmp } })))
    note(`photo images: ${JSON.stringify(imgs)}`)
    check(imgs.length > 0 && imgs.every(i => i.shownWidth > 0), '[photos] the saved photo shows in the trace')
  })

  await scenario('build', 'Build me a habit tracker web app as a project with these separate files: index.html, styles.css, app.js, storage.js, habits.js and README.md. Habits can be added, ticked off per day and deleted, and are kept in the browser. Write all six files now, then tell me in one sentence what you made.', async (text) => {
    check((text.match(/Created/g) || []).length >= 5, `[build] about six files created (${(text.match(/Created/g) || []).length})`)
    try {
      await page.getByRole('tab', { name: 'Preview' }).click({ timeout: 8000 }); await sleep(2500)
      await shot('build-3-preview')
      const frame = page.frameLocator('iframe[title^="Preview of"]')
      check(await frame.locator('body *').count() > 3, '[build] the preview shows a page')
    } catch (e) { check(false, `[build] preview: ${redact(e.message).slice(0, 140)}`) }
  })

  await scenario('workflow', 'Build me a workflow called "Weekly fintech digest". The trigger is a webhook. It has one AI step that writes a five-bullet digest on the topic it is given. Then run it now with the topic "mobile money in Ghana" and tell me what it wrote.', async () => {
    const list = await (await api('/api/workflows')).json().catch(() => [])
    const wf = (Array.isArray(list) ? list : list.workflows || []).find(w => /digest/i.test(w.title || ''))
    check(!!wf, '[workflow] it exists in Workflow Studio')
    if (wf) {
      await page.goto(`${BASE}/workflows/${wf.id}`, { waitUntil: 'domcontentloaded' }); await sleep(6000)
      await shot('workflow-3-studio')
      const runs = await (await api(`/api/workflows/${wf.id}/runs`)).json().catch(() => null)
      const l = Array.isArray(runs) ? runs : runs?.runs
      check(Array.isArray(l) && l[0]?.status === 'completed', `[workflow] it ran to the end (${l?.[0]?.status})`)
      note(`workflow run: ${JSON.stringify(l?.[0]?.logs?.map?.(x => ({ n: x.nodeId, s: x.status, m: String(x.message).slice(0, 140) })) ?? l?.[0]).slice(0, 600)}`)
    }
  })

  await scenario('task', 'Set up a background task: research the three biggest mobile money providers in Ghana and give me a short Word briefing with one paragraph each. The Word file must exist.', async () => {
    check(await page.getByText('Start task').count() > 0, '[task] the proposal card with a Start button is shown')
    await shot('task-3-card')
    try {
      await page.getByRole('button', { name: /start task/i }).first().click({ timeout: 6000 })
      await sleep(5000)
      await shot('task-4-started')
      const t = await poll(async () => { const a = await (await api('/api/tasks')).json(); return (Array.isArray(a) ? a : a.tasks || [])[0] }, x => x && ['done', 'partial', 'failed', 'cancelled', 'needs_review'].includes(x.status), 9 * 60_000)
      note(`task ended: ${t?.status} ${String(t?.outcome || '').slice(0, 160)}`)
      check(t?.status === 'done' || t?.status === 'partial', `[task] it finished (${t?.status})`)
      if (t?.id) { await page.goto(`${BASE}/tasks/${t.id}`, { waitUntil: 'domcontentloaded' }); await sleep(5000); await shot('task-5-finished') }
    } catch (e) { check(false, `[task] start: ${redact(e.message).slice(0, 160)}`) }
  })


  // "Use this again" and the alerts row. The task is created straight through the API, so this check does not depend on a model deciding to propose one.
  if (ONLY.includes('useagain')) {
    try {
      const made = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ goal: 'Research the three largest mobile money providers in Ghana and write a one-page summary as a Word document.', criteria: [{ text: 'A Word file exists with one paragraph for each provider', kind: 'file', format: 'docx' }] }) })
      const created = await made.json()
      check(made.status < 300 && !!created.id, `[useagain] a task was created (${made.status})`)
      const t = await poll(async () => (await (await api(`/api/tasks/${created.id}`)).json()).task, x => x && ['done', 'partial', 'failed', 'cancelled', 'needs_review'].includes(x.status), 9 * 60_000)
      note(`useagain task ended: ${t?.status} ${String(t?.outcome || '').slice(0, 160)}`)
      await page.goto(`${BASE}/tasks/${created.id}`, { waitUntil: 'domcontentloaded' }); await sleep(5000); await shot('useagain-1-task')
      if (t?.status === 'done') {
        // "Use this again": run it again, schedule it, keep it as an agent.
        check(await page.getByText('Use this again').count() > 0, '[useagain] the "Use this again" box shows on a finished task')
        await shot('task-6-use-again')
        await page.getByRole('button', { name: /save as agent/i }).first().click({ timeout: 6000 }); await sleep(1200)
        check(await page.locator('[role="group"][aria-label="Save as an agent"]').count() === 1, '[useagain] the save-as-agent card opens (gradient approval style)')
        await shot('task-7-save-as-agent')
        await page.getByRole('button', { name: /^save agent$/i }).first().click({ timeout: 6000 }); await sleep(3500)
        const agents = await (await api('/api/agents')).json()
        const list = Array.isArray(agents) ? agents : agents.agents || []
        check(list.some(a => String(a.instructions).includes(String(t.goal).slice(0, 30))), `[useagain] the agent was saved from the task (${list.map(a => a.name).join(', ').slice(0, 120)})`)
        await shot('task-8-agent-saved')
        const before = (await (await api('/api/tasks')).json())
        const beforeIds = new Set((Array.isArray(before) ? before : before.tasks || []).map(x => x.id))
        await page.getByRole('button', { name: /run again/i }).first().click({ timeout: 6000 }); await sleep(5000)
        check(/\/tasks\/[^/]+$/.test(page.url()) && !page.url().endsWith(t.id), '[useagain] Run again starts a new task and opens it')
        const after = (await (await api('/api/tasks')).json())
        const fresh = (Array.isArray(after) ? after : after.tasks || []).find(x => !beforeIds.has(x.id))
        check(!!fresh && fresh.goal === t.goal, '[useagain] the new task has the same goal')
        if (fresh) { await api(`/api/tasks/${fresh.id}/cancel`, { method: 'POST' }).catch(() => {}) }
        await page.goto(`${BASE}/tasks/${t.id}`, { waitUntil: 'domcontentloaded' }); await sleep(4000)
        await page.getByRole('button', { name: /^schedule$/i }).first().click({ timeout: 6000 }); await sleep(3500)
        const filled = await page.locator('textarea').first().inputValue().catch(() => '')
        check(/\/tasks$/.test(page.url()) && filled.startsWith(String(t.goal).slice(0, 20)), `[useagain] Schedule opens the form with the task filled in (${filled.slice(0, 50)})`)
        await shot('task-9-schedule-filled')
      } else { check(await page.getByText('Use this again').count() === 0, `[useagain] the box is hidden when the task is ${t?.status}`) }
      // Settings: the alerts row.
      await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' }); await sleep(5000)
      check(await page.getByText('Alerts on this device').count() > 0, '[settings] the "Alerts on this device" row is there')
      await page.getByText('Alerts on this device').first().scrollIntoViewIfNeeded().catch(() => {}); await sleep(600)
      await shot('settings-alerts')
    } catch (e) { check(false, `[useagain] ${redact(e.message).slice(0, 200)}`) }
  }

  await scenario('agent', 'Suggest an agent I can keep for writing polite payment reminder messages to late-paying clients in Ghana. Keep it simple.', async () => {
    check(await page.getByText('Save agent').count() > 0, '[agent] the proposal card with a Save button is shown')
    await shot('agent-3-card')
    try {
      await page.getByRole('button', { name: /save agent/i }).first().click({ timeout: 6000 }); await sleep(3500)
      await shot('agent-4-saved')
      await page.goto(`${BASE}/agents`, { waitUntil: 'domcontentloaded' }); await sleep(4000)
      await shot('agent-5-list')
    } catch (e) { check(false, `[agent] save: ${redact(e.message).slice(0, 160)}`) }
  })

  await scenario('hackernews', 'Use my connected apps to get the current top three stories on Hacker News and tell me their titles and links. This is a read only lookup.', async (text) => {
    note(`hackernews answer tail: ${redact(text.slice(-700))}`)
    check(/news\.ycombinator\.com|item\?id=\d{6,}/i.test(text), '[hackernews] the answer has real Hacker News links')
    check(!/connect .*(hacker|app)|sign in to|authorize/i.test(text.slice(-900)), '[hackernews] it did not ask for a sign-in')
  }, BASE, t => /news\.ycombinator\.com|item\?id=\d{6,}/i.test(t) || /sign in|connect/i.test(t.slice(-900)))

  await scenario('bigbuild', 'Build me a website for a bakery in Accra as a project with these files: index.html, menu.html, about.html, contact.html, styles.css, main.js, menu.js, cart.js, data/menu.json and README.md. The menu page reads data/menu.json and the cart is kept in the browser. Write every file now, then tell me in one sentence what you made.', async (text) => {
    const made = (text.match(/Created/g) || []).length
    check(made >= 9, `[bigbuild] about ten files created (${made})`)
    try {
      await page.getByRole('tab', { name: 'Preview' }).click({ timeout: 8000 }); await sleep(2500)
      await shot('bigbuild-3-preview')
      check(await page.frameLocator('iframe[title^="Preview of"]').locator('body *').count() > 3, '[bigbuild] the preview shows a page')
    } catch (e) { check(false, `[bigbuild] preview: ${redact(e.message).slice(0, 140)}`) }
  })

  if (ONLY.includes('agentchat')) {
    const mk = await api('/api/agents', { method: 'POST', body: JSON.stringify({ name: 'Polite reminders', description: 'Payment reminders for late clients', instructions: 'You write polite payment reminder messages to late-paying clients in Ghana. Always start the message with the words "Payment reminder:" and end it with the line "Thank you, Mensah Labs." Keep it under 90 words.', tools: [] }) })
    const made = await mk.json().catch(() => ({}))
    const agentId = made.id || made.agent?.id
    check(!!agentId, '[agentchat] the agent was saved')
    if (agentId) {
      await scenario('agentchat', 'Client Kofi Asante owes GHS 1,200 for a logo design. It is 14 days late. Write the message.', async (text) => {
        check(/Payment reminder:/.test(text), '[agentchat] the reply starts the way the agent was told to')
        check(/Thank you, Mensah Labs\./.test(text), '[agentchat] the reply ends the way the agent was told to')
        check(await page.getByText('Polite reminders').count() > 0, '[agentchat] the chat shows which agent is answering')
      }, `${BASE}/?agent=${agentId}`)
    }
  }

  // Chat menus, pinning, moving between workspaces, export, ghost mode, mono chips, Appearance. Chats and workspaces are made through the API (no model needed).
  if (ONLY.includes('chatui')) {
    const J = async (r) => r.json().catch(() => ({}))
    const mkChat = async (body) => { const r = await api('/api/chats', { method: 'POST', body: JSON.stringify(body) }); return { status: r.status, body: await J(r) } }
    const menuLabels = async () => (await page.locator('[role="menuitem"]').allInnerTexts()).map(t => t.trim()).filter(Boolean)
    try {
      const wsA = await J(await api('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: 'UI test bakery' }) }))
      const wsB = await J(await api('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: 'UI test shop sign' }) }))
      check(!!wsA.id && !!wsB.id, '[chatui] two workspaces were made')
      const loose = await mkChat({ input: 'Weekly payment reminders for the bakery' })
      check(loose.status < 300 && !!loose.body.id, `[chatui] a plain chat was made (${loose.status})`)
      const inWs = await mkChat({ input: 'Reply to the supplier in Kumasi', workspaceId: wsA.id })
      check(inWs.status < 300 && !!inWs.body.id, '[chatui] a chat was made inside a workspace')
      check((await J(await api('/api/chats'))).find(c => c.id === inWs.body.id)?.workspaceId === wsA.id, '[chatui] the list says it is in that workspace')

      // Server: pin / unpin
      const pin = await api(`/api/chats/pin/${loose.body.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: true }) })
      check(pin.status === 200, `[chatui] pin works (${pin.status})`)
      let list = await J(await api('/api/chats'))
      check(list.find(c => c.id === loose.body.id)?.pinned === true, '[chatui] the chat list says it is pinned')
      const unpin = await api(`/api/chats/pin/${loose.body.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: false }) })
      list = await J(await api('/api/chats'))
      check(unpin.status === 200 && !list.find(c => c.id === loose.body.id)?.pinned, '[chatui] unpin works')

      // Sidebar menu for a chat in no workspace
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await sleep(6000)
      const row = page.locator('a', { hasText: 'Weekly payment reminders' }).first()
      await row.hover(); await sleep(400)
      await row.locator('[aria-label="Chat actions"]').click({ timeout: 6000, force: true }); await sleep(900)
      let labels = await menuLabels()
      note(`sidebar menu: ${labels.join(' | ')}`)
      check(['Pin', 'Share', 'Rename', 'Add to workspace', 'Export', 'Delete'].every(l => labels.includes(l)) && !labels.includes('Remove from workspace'), '[chatui] a chat outside any workspace offers Add to workspace and no Remove')
      await shot('chatui-1-sidebar-menu')
      await page.getByRole('menuitem', { name: 'Pin', exact: true }).click(); await sleep(1800)
      check(await page.getByText('Pinned', { exact: true }).count() > 0, '[chatui] Pin puts the chat under a Pinned heading in the sidebar')
      await shot('chatui-2-pinned')

      // Workspace page: plain rows and the in-workspace menu
      await page.goto(`${BASE}/workspaces/${wsA.id}`, { waitUntil: 'domcontentloaded' }); await sleep(6000)
      const wrow = page.locator('li', { hasText: 'Reply to the supplier in Kumasi' }).first()
      check(await wrow.count() > 0, '[chatui] the workspace page lists its chat as a plain row')
      await wrow.hover(); await sleep(300)
      await wrow.getByRole('button', { name: 'Chat options' }).click({ timeout: 6000, force: true }); await sleep(900)
      labels = await menuLabels()
      note(`workspace row menu: ${labels.join(' | ')}`)
      check(labels.includes('Remove from workspace') && labels.includes('Move to workspace') && !labels.includes('Add to workspace'), '[chatui] a chat in a workspace offers Move and Remove, never Add')
      await shot('chatui-3-workspace-menu')
      // Export download
      const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null)
      await page.getByRole('menuitem', { name: 'Export', exact: true }).click()
      const file = await dl
      check(!!file && /\.md$/.test(file.suggestedFilename()), `[chatui] Export downloads a Markdown file (${file?.suggestedFilename?.()})`)
      // Remove from workspace
      await wrow.hover(); await sleep(300)
      await wrow.getByRole('button', { name: 'Chat options' }).click({ timeout: 6000, force: true }); await sleep(700)
      await page.getByRole('menuitem', { name: 'Remove from workspace' }).click(); await sleep(3000)
      list = await J(await api('/api/chats'))
      check(!list.find(c => c.id === inWs.body.id)?.workspaceId, '[chatui] Remove from workspace takes the chat out')
      await shot('chatui-4-removed')

      // Chat header: three dots, no colour switch
      await page.goto(`${BASE}/chat/${loose.body.id}`, { waitUntil: 'domcontentloaded' }); await sleep(6000)
      check(await page.getByRole('button', { name: 'Chat options' }).count() === 1, '[chatui] the chat header has the three-dot menu')
      check(await page.locator('header button:has(.i-lucide-sun), header button:has(.i-lucide-moon)').count() === 0, '[chatui] the light/dark switch is gone from the chat header')
      await page.getByRole('button', { name: 'Chat options' }).click(); await sleep(900)
      note(`header menu: ${(await menuLabels()).join(' | ')}`)
      await shot('chatui-5-header-menu')
      await page.keyboard.press('Escape'); await sleep(300)

      // Ghost mode
      const ghost = await mkChat({ ghost: true, input: 'A private question' })
      check(ghost.status < 300 && !!ghost.body.id, `[chatui] a ghost chat was made (${ghost.status})`)
      list = await J(await api('/api/chats'))
      check(!list.some(c => c.id === ghost.body.id), '[chatui] a ghost chat is not in the history')
      check((await mkChat({ ghost: true, workspaceId: wsA.id, input: 'x' })).status === 400, '[chatui] ghost mode refuses a workspace')
      check((await api(`/api/chats/pin/${ghost.body.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: true }) })).status === 400, '[chatui] a ghost chat cannot be pinned')
      await page.goto(`${BASE}/chat/${ghost.body.id}`, { waitUntil: 'domcontentloaded' }); await sleep(6000)
      check(await page.getByText('Ghost mode', { exact: true }).count() > 0 && await page.getByRole('button', { name: 'Chat options' }).count() === 0, '[chatui] a ghost chat shows the Ghost mode label and no menu')
      await shot('chatui-6-ghost-chat')
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await sleep(4000)
      const after = await api(`/api/chats/${ghost.body.id}`)
      check(after.status === 404, `[chatui] the ghost chat is gone after leaving (${after.status})`)
      await page.getByRole('button', { name: 'Ghost mode' }).click(); await sleep(500)
      await shot('chatui-7-home-ghost')

      // Settings > Appearance
      await page.goto(`${BASE}/settings?s=appearance`, { waitUntil: 'domcontentloaded' }); await sleep(5000)
      await page.getByRole('button', { name: 'Violet' }).click({ timeout: 6000 }); await page.getByRole('button', { name: 'Large' }).click(); await page.getByRole('button', { name: 'Narrow' }).click(); await page.getByRole('button', { name: 'Reduced' }).click(); await sleep(500)
      const attrs = await page.evaluate(() => ['data-accent', 'data-text', 'data-width', 'data-motion'].map(a => document.documentElement.getAttribute(a)).join(','))
      check(attrs === 'violet,large,narrow,reduced', `[chatui] Appearance sets the page (${attrs})`)
      await shot('chatui-8-appearance')
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(4000)
      const kept = await page.evaluate(() => document.documentElement.getAttribute('data-accent'))
      check(kept === 'violet', `[chatui] the choice is kept after a reload (${kept})`)
      await page.getByRole('button', { name: 'Back to the defaults' }).click().catch(() => {}); await sleep(300)

      // Tasks with mono chips (any task made by an earlier scenario)
      const tl = await J(await api('/api/tasks'))
      const tasks = Array.isArray(tl) ? tl : tl.tasks || []
      if (tasks.length) {
        await page.goto(`${BASE}/tasks`, { waitUntil: 'domcontentloaded' }); await sleep(5000); await shot('chatui-9-tasks')
        await page.goto(`${BASE}/tasks/${tasks[0].id}`, { waitUntil: 'domcontentloaded' }); await sleep(5000); await shot('chatui-10-task')
      }
      for (const c of [loose.body.id, inWs.body.id]) await api(`/api/chats/${c}`, { method: 'DELETE' }).catch(() => {})
      for (const w of [wsA.id, wsB.id]) await api(`/api/workspaces/${w}`, { method: 'DELETE' }).catch(() => {})
    } catch (e) { check(false, `[chatui] ${redact(e.message).slice(0, 220)}`) }
  }


  // Settings: the section list, Defaults, Approvals and safety, Powers, Data controls. Runs last because it deletes every chat of the test user.
  if (ONLY.includes('settings')) {
    const J = async (r) => r.json().catch(() => ({}))
    const nav = (label) => page.locator('nav[aria-label="Settings sections"] button', { hasText: label })
    try {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' }); await sleep(5000)
      const labels = (await page.locator('nav[aria-label="Settings sections"] button').allInnerTexts()).map(t => t.trim())
      note(`settings sections: ${labels.join(' | ')}`)
      check(['Account', 'Plan and usage', 'Appearance', 'Defaults', 'Voice', 'Notifications', 'Approvals and safety', 'Powers', 'Data controls'].every(l => labels.includes(l)), '[settings] the section list has all nine sections')
      check(await page.getByRole('heading', { name: 'Account', level: 2 }).count() === 1, '[settings] Account is the section that opens first')
      await shot('settings-1-account')
      await nav('Powers').click(); await sleep(600)
      check(page.url().includes('s=powers') && await page.getByRole('heading', { name: 'Powers', level: 2 }).count() === 1, `[settings] choosing a section opens it and puts it in the address (${page.url().split('/').pop()})`)
      await page.goto(`${BASE}/settings?s=data`, { waitUntil: 'domcontentloaded' }); await sleep(4000)
      check(await page.getByRole('heading', { name: 'Data controls', level: 2 }).count() === 1, '[settings] an address with ?s= opens that section')
      await page.goto(`${BASE}/settings?s=nonsense`, { waitUntil: 'domcontentloaded' }); await sleep(3000)
      check(await page.getByRole('heading', { name: 'Account', level: 2 }).count() === 1, '[settings] an unknown section falls back to Account')

      // Defaults
      await page.goto(`${BASE}/settings?s=defaults`, { waitUntil: 'domcontentloaded' }); await sleep(4000)
      await shot('settings-2-defaults')
      await page.getByRole('button', { name: 'Ctrl + Enter sends' }).click(); await page.getByRole('button', { name: '14:05' }).click(); await sleep(300)
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('openlobs.preferences') || '{}'))
      check(stored.enterSends === 'mod' && stored.timeStyle === 'exact', `[settings] Defaults are kept on this device (${JSON.stringify(stored)})`)
      await page.getByRole('button', { name: 'Always this one' }).click(); await sleep(500)
      check(await page.getByRole('combobox', { name: 'Model for new chats' }).count() === 1, '[settings] "Always this one" shows a model picker')
      await shot('settings-3-defaults-fixed-model')
      await page.getByRole('button', { name: 'Last used' }).click(); await sleep(300)
      check((await page.evaluate(() => JSON.parse(localStorage.getItem('openlobs.preferences') || '{}'))).newChatModel === '', '[settings] "Last used" clears the fixed model')
      // Enter now adds a line; Ctrl+Enter sends
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await sleep(5000)
      const box = page.locator('textarea').first()
      await box.click(); await box.fill('first line'); await page.keyboard.press('Enter'); await page.keyboard.type('second line'); await sleep(300)
      check(page.url().replace(/\/$/, '') === BASE.replace(/\/$/, '') && (await box.inputValue()).includes('\n'), '[settings] with Ctrl + Enter selected, Enter adds a new line instead of sending')
      await page.keyboard.press('Control+Enter'); await sleep(5000)
      check(/\/chat\//.test(page.url()), `[settings] Ctrl + Enter sends (${page.url().split('/').slice(-2).join('/')})`)
      await page.evaluate(() => localStorage.removeItem('openlobs.preferences'))

      // Approvals and safety
      await page.goto(`${BASE}/settings?s=approvals`, { waitUntil: 'domcontentloaded' }); await sleep(4000)
      check(await page.getByRole('heading', { name: 'Always asks first', level: 3 }).count() === 1 && await page.getByText('Always', { exact: true }).count() >= 4, '[settings] Approvals lists what it always asks first, with mono chips')
      check(await page.getByRole('switch').count() === 0, '[settings] nothing on Approvals pretends to be a switch')
      await shot('settings-4-approvals')
      await page.getByRole('button', { name: /Tell me when it is waiting/ }).click(); await sleep(600)
      check(page.url().includes('s=notifications'), '[settings] "Tell me when it is waiting" goes to Notifications')

      // Powers
      const p0 = await J(await api('/api/account/powers'))
      check(Object.values(p0.powers || {}).length === 6 && Object.values(p0.powers).every(v => v === true), `[settings] every power starts on (${JSON.stringify(p0.powers)})`)
      check((await api('/api/account/powers', { method: 'PUT', body: JSON.stringify({ nonsense: true }) })).status === 400, '[settings] an unknown power is refused')
      check((await api('/api/account/powers', { method: 'PUT', body: JSON.stringify({ web: 'no' }) })).status === 400, '[settings] a non-boolean value is refused')
      await page.goto(`${BASE}/settings?s=powers`, { waitUntil: 'domcontentloaded' }); await sleep(5000)
      await shot('settings-5-powers')
      const cloud = page.getByRole('switch', { name: 'Run programs in the cloud' })
      check(await cloud.count() === 1 && await cloud.getAttribute('aria-checked') === 'true', '[settings] Powers shows the cloud switch on')
      await cloud.click(); await sleep(1500)
      let p1 = await J(await api('/api/account/powers'))
      check(p1.powers?.cloud === false && p1.powers?.web === true, `[settings] switching one off saves only that one (${JSON.stringify(p1.powers)})`)
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(5000)
      check(await page.getByRole('switch', { name: 'Run programs in the cloud' }).getAttribute('aria-checked') === 'false', '[settings] the switch is still off after a reload')
      await shot('settings-6-powers-off')
      await page.getByRole('switch', { name: 'Run programs in the cloud' }).click(); await sleep(1500)
      p1 = await J(await api('/api/account/powers'))
      check(p1.powers?.cloud === true, '[settings] switching it back on works')
      check(await page.getByRole('switch', { name: 'Remember things about you' }).count() === 1, '[settings] the memory switch is on the Powers page')

      // Phone: the section list is one row you swipe, and the open section stays in view
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`${BASE}/settings?s=powers`, { waitUntil: 'domcontentloaded' }); await sleep(5000)
      const strip = await page.evaluate(() => { const n = document.querySelector('nav[aria-label="Settings sections"]'); const a = n?.querySelector('[aria-current="page"]'); const r = a?.getBoundingClientRect(); return { scrolls: n ? n.scrollWidth > n.clientWidth : false, inView: !!r && r.left >= 0 && r.right <= window.innerWidth + 1 } })
      check(strip.scrolls && strip.inView, `[settings] on a phone the list scrolls sideways and the open section is in view (${JSON.stringify(strip)})`)
      await shot('settings-7-phone-powers')
      await page.setViewportSize({ width: 1280, height: 800 })

      // Data controls
      const keep = await J(await api('/api/chats', { method: 'POST', body: JSON.stringify({ input: 'A chat to delete' }) }))
      const ws = await J(await api('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Settings test shop' }) }))
      const inWs = await J(await api('/api/chats', { method: 'POST', body: JSON.stringify({ input: 'A chat inside a workspace', workspaceId: ws.id }) }))
      await api('/api/memory', { method: 'POST', body: JSON.stringify({ text: 'Prefers WhatsApp for reminders' }) })
      await page.goto(`${BASE}/settings?s=data`, { waitUntil: 'domcontentloaded' }); await sleep(5000)
      await shot('settings-8-data')
      await page.getByRole('button', { name: 'Clear', exact: true }).click(); await sleep(700)
      check(await page.getByText('Clear your memory?').count() === 1, '[settings] Clear memory asks first')
      await shot('settings-9-confirm')
      await page.getByRole('button', { name: 'Cancel' }).click(); await sleep(500)
      check(((await J(await api('/api/memory'))).items || []).length >= 1, '[settings] Cancel leaves memory alone')
      await page.getByRole('button', { name: 'Clear', exact: true }).click(); await sleep(500)
      await page.getByRole('button', { name: 'Clear memory', exact: true }).click(); await sleep(2000)
      check(((await J(await api('/api/memory'))).items || []).length === 0, '[settings] confirming clears memory')
      await page.getByRole('button', { name: 'Delete chats' }).click(); await sleep(700)
      check(await page.getByText('Delete all your chats?').count() === 1, '[settings] Delete all chats asks first')
      await page.getByRole('button', { name: 'Cancel' }).click(); await sleep(500)
      check((await J(await api('/api/chats'))).some(c => c.id === keep.id), '[settings] Cancel leaves the chats alone')
      await page.getByRole('button', { name: 'Delete chats' }).click(); await sleep(500)
      await page.getByRole('button', { name: 'Delete all chats', exact: true }).click(); await sleep(3500)
      const left = await J(await api('/api/chats'))
      check(Array.isArray(left) && left.length === 0, `[settings] confirming deletes every chat (${Array.isArray(left) ? left.length : 'bad'} left)`)
      check((await api(`/api/chats/${inWs.id}`)).status === 404, '[settings] a chat inside a workspace was deleted too')
      check((await api(`/api/workspaces/${ws.id}`)).status === 200, '[settings] the workspace itself stays')
      await shot('settings-10-after-delete')
      await api(`/api/workspaces/${ws.id}`, { method: 'DELETE' }).catch(() => {})
    } catch (e) { check(false, `[settings] ${redact(e.message).slice(0, 220)}`) }
  }


  // Workspace Notes and Powers: the screens, then a real chat that saves a note, undo, and a second chat that reads it back.
  if (ONLY.includes('wsnotes')) {
    const J = async (r) => r.json().catch(() => ({}))
    try {
      const ws = await J(await api('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Kofi logo', instructions: 'Friendly, plain English. Prices in cedis.' }) }))
      check(!!ws.id && ws.powers?.notes === true && ws.whereWeAre === null, `[wsnotes] a new workspace has every power on and no summary (${JSON.stringify(ws.powers)})`)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`${BASE}/workspaces/${ws.id}`, { waitUntil: 'domcontentloaded' }); await sleep(6000)
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(6000)
      const tabNames = (await page.getByRole('tab').allInnerTexts()).map(t => t.trim())
      check(tabNames.join('|') === 'Chats|Notes', `[wsnotes] the tabs are plain words with no counts (${tabNames.join('|')})`)
      await shot('wsnotes-1-chats-tab')

      // Powers row
      const powersBtn = page.getByRole('button', { name: /^Powers/ })
      check(/6 of 6 on/i.test(await powersBtn.innerText()), `[wsnotes] Powers starts at 6 of 6 on (${(await powersBtn.innerText()).replace(/\s+/g, ' ')})`)
      await powersBtn.click(); await sleep(700)
      await shot('wsnotes-2-powers-open')
      await page.getByRole('switch', { name: 'Run programs in the cloud' }).click(); await sleep(1500)
      let d = await J(await api(`/api/workspaces/${ws.id}`))
      check(d.workspace?.powers?.cloud === false && d.workspace?.powers?.web === true, `[wsnotes] switching one off saves only that one (${JSON.stringify(d.workspace?.powers)})`)
      check(/5 of 6 on/i.test(await powersBtn.innerText()), '[wsnotes] the count follows')
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(6000)
      check(/5 of 6 on/i.test(await page.getByRole('button', { name: /^Powers/ }).innerText()), '[wsnotes] it is still off after a reload')
      await page.getByRole('button', { name: /^Powers/ }).click(); await sleep(600)
      await page.getByRole('switch', { name: 'Run programs in the cloud' }).click(); await sleep(1500)
      d = await J(await api(`/api/workspaces/${ws.id}`))
      check(d.workspace?.powers?.cloud === true, '[wsnotes] switching it back on works')

      // A power off in Settings shows as locked in the workspace
      check((await api('/api/account/powers', { method: 'PUT', body: JSON.stringify({ web: false }) })).status === 200, '[wsnotes] switched web off in Settings')
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(6000)
      await page.getByRole('button', { name: /^Powers/ }).click(); await sleep(700)
      const web = page.getByRole('switch', { name: 'Search and read the web' })
      check(await web.isDisabled() && await web.getAttribute('aria-checked') === 'false' && await page.getByText('Off in Settings').count() >= 1, '[wsnotes] a power off in Settings is locked off in the workspace')
      await shot('wsnotes-3-locked-by-settings')
      await api('/api/account/powers', { method: 'PUT', body: JSON.stringify({ web: true }) })

      // Notes tab
      await page.goto(`${BASE}/workspaces/${ws.id}?tab=notes`, { waitUntil: 'domcontentloaded' }); await sleep(6000)
      check(await page.getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected') === 'true', '[wsnotes] ?tab=notes opens the Notes tab')
      check(await page.getByText('Not written yet').count() === 1 && await page.getByText('Nothing saved yet').count() === 1, '[wsnotes] empty notes say so')
      await shot('wsnotes-4-notes-empty')
      await page.getByRole('button', { name: 'Write', exact: true }).click(); await sleep(700)
      await page.getByLabel('Where we are').fill('Logo direction is chosen. Next: export the files.')
      await page.getByRole('button', { name: 'Save', exact: true }).click(); await sleep(1500)
      d = await J(await api(`/api/workspaces/${ws.id}/notes`))
      check(d.whereWeAre?.text === 'Logo direction is chosen. Next: export the files.' && d.whereWeAre?.by === 'you', `[wsnotes] the summary is saved as the person's (${JSON.stringify(d.whereWeAre)})`)
      await page.getByLabel('Write a note').fill('Invoices go out on the 25th. Kofi pays by MoMo.')
      await page.keyboard.press('Enter'); await sleep(1500)
      d = await J(await api(`/api/workspaces/${ws.id}/notes`))
      check(d.notes.length === 1 && d.notes[0].by === 'you', '[wsnotes] a typed note is saved')
      check(await page.getByText('Invoices go out on the 25th').count() === 1 && await page.getByText('You', { exact: true }).count() >= 1, '[wsnotes] it shows in the list with a YOU chip')
      await shot('wsnotes-5-notes-filled')
      await page.getByRole('button', { name: 'Delete note' }).first().click(); await sleep(1500)
      check((await J(await api(`/api/workspaces/${ws.id}/notes`))).notes.length === 0, '[wsnotes] a note can be deleted')

      // Notes off in the workspace: the page says so
      await api(`/api/workspaces/${ws.id}`, { method: 'PATCH', body: JSON.stringify({ powers: { notes: false } }) })
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(6000)
      check(await page.getByText(/Notes are off for this workspace/).count() === 1, '[wsnotes] with notes off the page says the assistant is not reading or saving them')
      await shot('wsnotes-6-notes-off')
      await api(`/api/workspaces/${ws.id}`, { method: 'PATCH', body: JSON.stringify({ powers: { notes: true } }) })
      await J(await api(`/api/workspaces/${ws.id}/where-we-are`, { method: 'PUT', body: JSON.stringify({ text: '' }) }))

      // Phone
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`${BASE}/workspaces/${ws.id}?tab=notes`, { waitUntil: 'domcontentloaded' }); await sleep(6000)
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '[wsnotes] on a phone the Notes tab does not widen the page')
      await shot('wsnotes-7-phone-notes')
      await page.setViewportSize({ width: 1440, height: 900 })

      // A real chat that saves a note, then Undo, then a second chat that reads it
      await scenario('wsnotes', 'Kofi just called. He picked option 2, the warm yellow mark, and wants no red anywhere. Please keep that in this workspace\'s notes, and tell me in one sentence when it is saved.', async (text) => {
        check(/Saved to notes|Already in notes/i.test(text), '[wsnotes] the trace shows "Saved to notes"')
        const after = await J(await api(`/api/workspaces/${ws.id}/notes`))
        const mine = after.notes.filter(n => n.by === 'assistant')
        check(mine.length >= 1 && mine.some(n => /yellow|red|option 2/i.test(n.text)), `[wsnotes] the assistant saved a note of its own (${mine.map(n => n.text).join(' | ')})`)
        await shot('wsnotes-8-chat-saved')
        const undo = page.getByRole('button', { name: 'Undo', exact: true }).first()
        if (await undo.count()) {
          await undo.click(); await sleep(2000)
          const left = await J(await api(`/api/workspaces/${ws.id}/notes`))
          check(left.notes.length < after.notes.length, '[wsnotes] Undo in the chat removes the note')
          await shot('wsnotes-9-chat-undone')
        } else check(false, '[wsnotes] the trace has an Undo')
      }, `${BASE}/workspaces/${ws.id}`, t => /Saved to notes|Already in notes|notes/i.test(t))
      // Put a note back by hand, then a brand new chat has to know it without being told.
      await api(`/api/workspaces/${ws.id}/notes`, { method: 'POST', body: JSON.stringify({ text: 'Kofi chose option 2, the warm yellow mark.' }) })
      await scenario('wsnotes-read', 'Which logo option did Kofi choose? Answer in one short sentence from what you know about this job.', async (text) => {
        check(/yellow|option 2/i.test(text.split('Which logo option did Kofi choose?').pop() || ''), '[wsnotes] a new chat in the workspace already knows the note')
      }, `${BASE}/workspaces/${ws.id}`, t => /yellow|option 2/i.test(t))
    } catch (e) { check(false, `[wsnotes] ${redact(e.message).slice(0, 220)}`) }
  }

  if (problems.length) process.exitCode = 1
} catch (err) {
  note(`FAILED: ${redact(err?.message || err)}`)
  if (page) await shot('99-where-it-stopped')
  process.exitCode = 1
} finally {
  writeFileSync(`${OUT}/notes.txt`, notes.join('\n'))
  writeFileSync(`${OUT}/server-log.txt`, redact(serverLog).slice(-80_000))
  if (browser) await browser.close().catch(() => {})
  stop()
}
async function poll(fn, done, ms, every = 8000) { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn().catch(() => null); if (done(last)) return last; await sleep(every) } return last }
