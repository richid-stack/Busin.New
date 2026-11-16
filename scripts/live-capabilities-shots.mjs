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
  for (const u of ['/src/pages/chat/%5Bid%5D.vue', '/src/pages/index.vue', '/src/pages/tasks/%5Bid%5D.vue', '/src/pages/workflows/%5Bid%5D.vue', '/src/pages/agents/index.vue']) { try { await fetch(`${BASE}${u}`) } catch {} }
  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark', acceptDownloads: true })
  page = await ctx.newPage()
  page.on('pageerror', e => note(`page error: ${redact(e.message).slice(0, 200)}`))
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await sleep(6000)
  await page.getByRole('button', { name: /sign in|log in|get started/i }).first().click({ timeout: 20_000 })
  await sleep(1500)
  await page.getByPlaceholder('name@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: /^sign in$/i }).last().click()
  await sleep(6000)

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
