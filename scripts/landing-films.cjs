/**
 * Films the real app doing real work with real models, for the landing page.
 * Sign-in and data come from Google's local test emulators (no real accounts); the model is a real one (Gemini first, Groq as a fallback
 * for the build scene) using the key in the repository secrets. Nothing on screen is scripted but the person's typing and clicking.
 *
 *   firebase emulators:exec --only auth,firestore --project demo-openlobs "node scripts/landing-films.cjs"
 *
 * Output (FILMS_OUT, default films/): project.mp4, specialist.mp4, notes.json (model used, timestamps of key moments), a few screenshots.
 * Chromium's screencast hands over a JPEG every time the page repaints, with a timestamp; those frames are rebuilt into a steady 30 fps file.
 */
const { chromium } = require('playwright-core')
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')

const PORT = 3100
const BASE = `http://127.0.0.1:${PORT}`
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`
const OUT = process.env.FILMS_OUT || 'films'
const TMP = process.env.RUNNER_TEMP ? `${process.env.RUNNER_TEMP}/film` : '/tmp/film'
const W = 1440, H = 900, DPR = 1.25
const ONLY = (process.env.FILM_SCENES || 'project,specialist').split(',')
const MODELS = (process.env.LIVE_MODELS || 'google/gemini-3.8-flash,google/gemini-3.5-flash,google/gemini-3.1-flash-lite,groq/gpt-oss-120b,groq/gpt-oss-20b,groq/qwen3.8-27b').split(',')
const KEYS = { google: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY' }
const usable = MODELS.filter(m => process.env[KEYS[m.split('/')[0]]])
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(TMP, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const redact = t => String(t).replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]').replace(/gsk_[0-9A-Za-z]{20,}/g, '[key]')
const notes = { scenes: {}, log: [] }
const note = m => { notes.log.push(redact(m)); console.log(redact(m)) }
const save = () => fs.writeFileSync(`${OUT}/notes.json`, JSON.stringify(notes, null, 1))

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  env: { ...process.env, GOOGLE_CLOUD_PROJECT: 'demo-openlobs', NODE_ENV: 'development', VITE_AUTH_EMULATOR_URL: AUTH, VITE_FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080' },
  stdio: ['ignore', 'pipe', 'pipe'], detached: true
})
let serverLog = ''
for (const s of [server.stdout, server.stderr]) s.on('data', d => { serverLog += d.toString(); if (serverLog.length > 300_000) serverLog = serverLog.slice(-150_000) })
const stopServer = () => { try { process.kill(-server.pid) } catch {} }
process.on('exit', stopServer)
async function waitForApp() { for (let i = 0; i < 150; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.status < 500) return true } catch {} await sleep(1000) } return false }

let token
const api = (p, init = {}) => fetch(`${BASE}${p}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}) } })
const EMAIL = `ama-${Date.now()}@example.com`, PASSWORD = 'film-password-123'

/** A tiny real request to see whether a model has room right now. */
async function hasRoom(m) {
  const created = await api('/api/chats', { method: 'POST', body: JSON.stringify({ input: 'ping' }) })
  const chat = await created.json()
  const res = await api(`/api/chats/${chat.id}`, { method: 'POST', headers: { Accept: 'text/event-stream' }, body: JSON.stringify({ model: m, messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Reply with the single word: pong' }] }] }) })
  const raw = await res.text()
  return res.status === 200 && /pong/i.test(raw) && !/"type":"error"/.test(raw)
}
const gone = new Set()
async function pickModel(onlyProvider) {
  for (const m of usable) {
    if (gone.has(m) || (onlyProvider && !m.startsWith(onlyProvider + '/'))) continue
    if (await hasRoom(m).catch(() => false)) return m
    note(`  ${m} has no room right now, next`); gone.add(m)
  }
  return null
}

const CURSOR = `
(() => {
  const mk = () => {
    if (document.getElementById('__cur') || !document.documentElement) return
    const c = document.createElement('div'); c.id = '__cur'
    c.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))'
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M5 3l16 9.5-7 1.8-3.6 6.4z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    document.documentElement.appendChild(c)
    const r = document.createElement('div'); r.id = '__rip'
    r.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid rgba(0,153,255,.95);z-index:2147483646;pointer-events:none;opacity:0;transform:scale(.3)'
    document.documentElement.appendChild(r)
    addEventListener('mousemove', e => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)' }, true)
    addEventListener('mousedown', e => { r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; r.animate([{ opacity: .9, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(1.3)' }], { duration: 520, easing: 'ease-out' }) }, true)
  }
  try { mk() } catch (e) {}
  document.addEventListener('DOMContentLoaded', () => { try { mk() } catch (e) {} })
})()`

class Film {
  constructor(name) { this.name = name; this.dir = `${TMP}/${name}`; this.frames = []; this.mx = 800; this.my = 450; this.marks = {} }
  async open(browser, model) {
    fs.rmSync(this.dir, { recursive: true, force: true }); fs.mkdirSync(this.dir, { recursive: true })
    this.ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, colorScheme: 'dark', reducedMotion: 'no-preference' })
    await this.ctx.addInitScript(CURSOR)
    await this.ctx.addInitScript(m => { try { localStorage.setItem('model', m) } catch {} }, model)
    this.page = await this.ctx.newPage()
    this.page.on('pageerror', e => note(`page error: ${redact(e.message).slice(0, 200)}`))
    await this.page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await sleep(6000)
    // Sign in before the camera rolls.
    await this.page.getByRole('button', { name: /sign in|log in|get started/i }).first().click({ timeout: 30_000 })
    await sleep(1500)
    await this.page.getByPlaceholder('name@example.com').fill(EMAIL)
    await this.page.getByPlaceholder('••••••••').fill(PASSWORD)
    await this.page.getByRole('button', { name: /^sign in$/i }).last().click()
    await this.page.getByText(/Good (morning|afternoon|evening)/).first().waitFor({ timeout: 60_000 }).catch(() => note('  (did not see the greeting)'))
    await this.page.mouse.move(this.mx, this.my)
    await sleep(1200)
    return this.page
  }
  async start() {
    this.cdp = await this.ctx.newCDPSession(this.page)
    this.t0 = null
    this.cdp.on('Page.screencastFrame', async ev => {
      const t = ev.metadata.timestamp
      if (this.t0 == null) this.t0 = t
      const f = `${this.dir}/f${String(this.frames.length).padStart(6, '0')}.jpg`
      fs.writeFileSync(f, Buffer.from(ev.data, 'base64'))
      this.frames.push({ f, t: t - this.t0 })
      this.cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
    })
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: Math.round(W * DPR), maxHeight: Math.round(H * DPR), everyNthFrame: 1 })
    this.wall = Date.now()
    await sleep(250)
  }
  mark(label) { const s = +((Date.now() - this.wall) / 1000).toFixed(2); this.marks[label] = s; note(`  [${this.name}] ${label} at ${s}s`); return s }
  async glide(x, y, ms = 650) {
    const sx = this.mx, sy = this.my, n = Math.max(6, Math.round(ms / 16))
    for (let i = 1; i <= n; i++) { const e = ease(i / n); await this.page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e); await sleep(ms / n) }
    this.mx = x; this.my = y
  }
  async over(locator, ms = 650, dx = 0.5, dy = 0.5) {
    const el = locator.first()
    await el.scrollIntoViewIfNeeded().catch(() => {})
    const b = await el.boundingBox()
    if (!b) throw new Error('no box for target')
    await this.glide(b.x + b.width * dx, b.y + b.height * dy, ms)
  }
  async click(locator, ms = 650) { await this.over(locator, ms); await sleep(120); await this.page.mouse.down(); await sleep(70); await this.page.mouse.up(); await sleep(150) }
  async type(text, perChar = 34) { for (const ch of text) { await this.page.keyboard.type(ch); await sleep(perChar + Math.random() * 22) } }
  async wheel(total, steps = 18, gap = 40) { for (let i = 0; i < steps; i++) { await this.page.mouse.wheel(0, total / steps); await sleep(gap) } }
  async shot(name) { try { await this.page.screenshot({ path: `${OUT}/${this.name}-${name}.png` }) } catch {} }
  /** Waits until the page text has stopped changing for `quiet` seconds (the answer has finished streaming). */
  async settle(maxS = 300, quiet = 12) {
    const start = Date.now(); let last = -1, still = 0
    await sleep(5000)
    while ((Date.now() - start) / 1000 < maxS) {
      await sleep(2000)
      const len = await this.page.evaluate(() => document.body.innerText.length).catch(() => last)
      still = len === last ? still + 2 : 0; last = len
      if (still >= quiet) return true
    }
    return false
  }
  async stop(keep = true) {
    await sleep(300)
    await this.cdp.send('Page.stopScreencast').catch(() => {})
    await this.ctx.close()
    const fr = this.frames
    if (!keep) { notes.scenes[this.name + '-discarded'] = { frames: fr.length }; return }
    if (fr.length < 2) throw new Error('no frames for ' + this.name)
    const list = fr.map((x, i) => `file '${x.f}'\nduration ${Math.max(0.001, (fr[i + 1] ? fr[i + 1].t - x.t : 0.25)).toFixed(4)}`).join('\n') + `\nfile '${fr[fr.length - 1].f}'\n`
    fs.writeFileSync(`${this.dir}/list.txt`, list)
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${this.dir}/list.txt`, '-vf', `fps=30,scale=${Math.round(W * DPR)}:${Math.round(H * DPR)}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${OUT}/${this.name}.mp4`])
    const dur = fr[fr.length - 1].t
    note(`  ${this.name}: ${fr.length} frames over ${dur.toFixed(1)} s`)
    fs.rmSync(this.dir, { recursive: true, force: true })
    return dur
  }
}

const PROJECT_PROMPT = "Build a one-page website for Akosua's Bakery in Osu, Accra. Warm cream background and a serif headline that says \"Bread that tastes like home.\" Show sugar bread, butter loaf and tea bread with prices in GHS, and an \"Order for tomorrow\" button. Make it a project with index.html, styles.css and app.js."
const SPECIALIST_PROMPTS = [
  'Compare the three best invoicing apps for a small shop in Ghana. Check each one’s current price on its own website and tell me which is cheapest.',
  'This is a research job. Use your researcher agent Chameleon to compare the three best invoicing apps for a small shop in Ghana. Check each one’s current price on its own website and tell me which is cheapest.'
]

async function projectScene(browser) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const m = await pickModel()
    if (!m) { note('[project] no model had room'); return false }
    note(`[project] attempt ${attempt + 1} with ${m}`)
    const f = new Film('project'); const page = await f.open(browser, m)
    await f.start(); await sleep(1200)
    f.mark('start')
    await f.click(page.locator('textarea').first(), 800)
    await f.type(PROJECT_PROMPT, 30)
    await sleep(500); await page.keyboard.press('Enter'); f.mark('sent')
    let paneAt = null
    const t0 = Date.now()
    while ((Date.now() - t0) / 1000 < 90 && paneAt == null) { await sleep(1000); if (await page.getByRole('tab', { name: 'Preview' }).first().isVisible().catch(() => false)) paneAt = f.mark('pane-open') }
    const done = await f.settle(300, 14)
    f.mark('answer-done')
    const text = await page.evaluate(() => document.body.innerText)
    const created = (text.match(/Created/g) || []).length
    note(`[project] settled=${done} created=${created}`)
    if (created < 2 || /free allowance|rate limit|busy right now|reached its/i.test(text.slice(-1500))) { note(`[project] ${m} did not finish a project, next`); gone.add(m); await f.stop(false); continue }
    await sleep(1500)
    try {
      await f.click(page.getByRole('tab', { name: 'Preview' }), 800); f.mark('preview'); await sleep(3000)
      await f.shot('preview')
      const html = page.frameLocator('iframe[title^="Preview of"]').locator('html')
      await html.evaluate(async el => { const w = el.ownerDocument.defaultView; const max = el.scrollHeight - w.innerHeight; const t0 = performance.now(); await new Promise(res => { const step = () => { const p = Math.min(1, (performance.now() - t0) / 3500); w.scrollTo(0, max * (p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2)); p < 1 ? requestAnimationFrame(step) : res() }; step() }) }).catch(() => {})
      await sleep(1200)
      await html.evaluate(el => el.ownerDocument.defaultView.scrollTo({ top: 0, behavior: 'smooth' })).catch(() => {})
      await sleep(1400)
    } catch (e) { note(`[project] preview: ${redact(e.message).slice(0, 140)}`) }
    try { await f.click(page.getByRole('tab', { name: /^Code$/ }), 700); f.mark('code'); await sleep(2600); await f.shot('code') } catch (e) { note(`[project] code tab: ${redact(e.message).slice(0, 100)}`) }
    try { await f.click(page.getByRole('tab', { name: 'Preview' }), 700); await sleep(2200) } catch {}
    f.mark('end')
    const dur = await f.stop()
    notes.scenes.project = { model: m, seconds: dur, marks: f.marks, filesCreated: created }
    return true
  }
  return false
}

async function specialistScene(browser) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const m = await pickModel('google')
    if (!m) { note('[specialist] no Gemini model had room (small free plans are not offered specialists)'); return false }
    const prompt = SPECIALIST_PROMPTS[Math.min(attempt, 1)]
    note(`[specialist] attempt ${attempt + 1} with ${m}`)
    const f = new Film('specialist'); const page = await f.open(browser, m)
    await f.start(); await sleep(1200)
    f.mark('start')
    await f.click(page.locator('textarea').first(), 800)
    await f.type(prompt, 28)
    await sleep(500); await page.keyboard.press('Enter'); f.mark('sent')
    const t0 = Date.now(); let handedAt = null
    while ((Date.now() - t0) / 1000 < 120 && handedAt == null) { await sleep(1500); if (/Chameleon/i.test(await page.evaluate(() => document.body.innerText).catch(() => ''))) handedAt = f.mark('handed-to-chameleon') }
    const done = await f.settle(300, 14)
    f.mark('answer-done')
    const text = await page.evaluate(() => document.body.innerText)
    const handed = /Chameleon/i.test(text)
    note(`[specialist] settled=${done} handed=${handed}`)
    if (!handed || /free allowance|rate limit|busy right now|reached its/i.test(text.slice(-1500))) { note(`[specialist] ${m} did not hand over (or hit a limit), trying again`); if (!handed && attempt >= 1) gone.add(m); await f.stop(false); continue }
    await sleep(1200)
    // Open the specialist's steps so the work is visible, then show the answer.
    try {
      await f.shot('closed')
      const rows = page.locator('button[aria-expanded="false"]'); let opened = 0
      for (let i = 0; i < await rows.count() && opened < 3; i++) {
        const b = await rows.nth(i).boundingBox().catch(() => null)
        if (!b || b.x < 260 || b.x > 900 || b.y < 60 || b.y > 840) continue
        await f.click(rows.nth(i), 700).catch(() => {}); opened++; await sleep(1400)
      }
      f.mark('steps-open'); await f.shot('open')
      await sleep(1800); await f.wheel(900, 24, 45); await sleep(2600)
    } catch (e) { note(`[specialist] steps: ${redact(e.message).slice(0, 140)}`) }
    f.mark('end')
    const dur = await f.stop()
    notes.scenes.specialist = { model: m, seconds: dur, marks: f.marks, attempt: attempt + 1, prompt }
    fs.writeFileSync(`${OUT}/specialist-text.txt`, redact(text).slice(0, 8000))
    return true
  }
  return false
}

;(async () => {
  let ok = false, browser
  try {
    if (!usable.length) throw new Error('No model key is set')
    if (!(await waitForApp())) throw new Error('The app did not start')
    const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true, displayName: 'Ama' }) })
    token = (await r.json()).idToken
    if (!token) throw new Error('The sign-in emulator gave no token')
    for (const u of ['/src/pages/chat/%5Bid%5D.vue', '/src/pages/index.vue', '/src/pages/tasks/%5Bid%5D.vue', '/src/pages/agents/index.vue', '/src/pages/settings.vue']) { try { await fetch(`${BASE}${u}`) } catch {} }
    browser = await chromium.launch()
    const results = {}
    if (ONLY.includes('project')) results.project = await projectScene(browser)
    if (ONLY.includes('specialist')) results.specialist = await specialistScene(browser)
    notes.results = results
    ok = Object.values(results).every(Boolean)
  } catch (e) { note(`FAILED: ${redact(e.message)}`) } finally {
    if (browser) await browser.close().catch(() => {})
    fs.writeFileSync(`${OUT}/server-log.txt`, redact(serverLog).slice(-60_000))
    save(); stopServer()
  }
  process.exit(ok ? 0 : 1)
})()
