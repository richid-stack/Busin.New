/**
 * Opens the real app in a real browser, signs in (Google's local test emulator, no real accounts), sends a simple
 * chat and a simple workflow request to a real model, and takes screenshots, including the trace open and closed.
 *
 *   firebase emulators:exec --only auth,firestore --project demo-openlobs "node scripts/live-chat-shots.mjs"
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const PORT = 3100
const BASE = `http://127.0.0.1:${PORT}`
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`
const OUT = process.env.SHOTS_OUT || 'shots'
mkdirSync(OUT, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const redact = t => String(t).replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]').replace(/gsk_[0-9A-Za-z]{20,}/g, '[key]')
const notes = []
const note = (m) => { notes.push(m); console.log(m) }

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  env: { ...process.env, GOOGLE_CLOUD_PROJECT: 'demo-openlobs', NODE_ENV: 'development', VITE_AUTH_EMULATOR_URL: AUTH, VITE_FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080' },
  stdio: ['ignore', 'pipe', 'pipe'], detached: true
})
let serverLog = ''
for (const s of [server.stdout, server.stderr]) s.on('data', d => { serverLog += d.toString(); if (serverLog.length > 200_000) serverLog = serverLog.slice(-100_000) })
const stop = () => { try { process.kill(-server.pid) } catch {} }
process.on('exit', stop)

async function waitForApp() {
  for (let i = 0; i < 150; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.status < 500) return true } catch {} await sleep(1000) }
  return false
}

let browser, page
const shot = async (name) => { try { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }); note(`shot ${name}`) } catch (e) { note(`could not take ${name}: ${e.message}`) } }

/** Waits until the answer stops growing (the model finished), or the time runs out. */
async function waitForAnswer(maxMs = 150_000) {
  const start = Date.now(); let last = -1; let stable = 0
  while (Date.now() - start < maxMs) {
    await sleep(2000)
    const len = (await page.evaluate(() => document.body.innerText.length)) 
    stable = len === last ? stable + 1 : 0
    last = len
    if (stable >= 4) return true
  }
  return false
}

/** Picks a Groq model in the model menu (the app opens on Gemini, which this run has no key for). */
async function pickGroq() {
  try {
    // Read what the picker next to the message box says right now (the menu is closed, so only the label is on screen).
    const label = await page.evaluate(() => [...document.querySelectorAll('button, div, span')].filter(e => e.children.length === 0 && e.getBoundingClientRect().y > 600 && /^(Gemini|GPT OSS|Qwen|Claude|GPT)/.test((e.textContent || '').trim())).map(e => (e.textContent || '').trim())[0] || '')
    if (/GPT OSS/i.test(label)) { note(`Groq model already selected (${label})`); return }
    note(`picker says "${label}", switching to Groq`)
    await page.getByText(/Gemini 3\.5 Flash|Gemini 3\.8 Flash|GPT OSS|Qwen/i).first().click({ timeout: 8000 })
    await sleep(800)
    await shot(`menu-${Date.now() % 100000}`)
    await page.getByText(/GPT OSS 120B/i).last().click({ timeout: 8000 })
    await sleep(600)
    note('picked GPT OSS 120B (Groq)')
  } catch (e) { note(`could not pick the Groq model: ${redact(e.message).slice(0, 160)}`) }
}

async function send(text) {
  await pickGroq()
  const box = page.locator('textarea').first()
  await box.click()
  await box.fill(text)
  await page.keyboard.press('Enter')
}


const SCENARIOS = [
  { id: 'search', set: 1, prompt: 'Search the web: what is the current Ghana cedi to US dollar rate? One line please.' },
  { id: 'weather-calc', set: 1, prompt: 'What is the weather in Accra right now, and what is 12.5% of GHS 2,450?' },
  { id: 'github', set: 1, prompt: 'Read the GitHub repo vuejs/core and tell me in two lines what it is.' },
  { id: 'skill', set: 2, prompt: 'Use a skill to help me write a short, polite email declining a quote.' },
  { id: 'plan', set: 1, prompt: 'Make me a short plan with steps to launch a small online shop in Ghana.' },
  { id: 'agent', set: 2, prompt: 'Create an agent that summarizes my unread emails every morning.' },
  { id: 'task', set: 2, prompt: 'Set up a task that checks the cedi rate every morning and tells me.' },
  { id: 'memory', set: 2, prompt: 'Remember that I prefer short answers and my business is called Mensah Labs.' },
  { id: 'chart', set: 2, prompt: 'Plot a chart of monthly sales: Jan 12, Feb 18, Mar 25, Apr 21.' },
  { id: 'assets', set: 2, prompt: 'Find me a clean font pairing and three icons for a Ghana coffee brand.' },
  { id: 'workflow', set: 2, prompt: 'Build me a workflow: when a client emails me, draft a reply and save it to Google Drive.' }
]
const SET = Number(process.env.TOUR_SET || 1)

try {
  if (!(await waitForApp())) throw new Error('The app did not start')
  const email = `tour-${Date.now()}@example.com`
  const password = 'tour-password-123'
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true, displayName: 'Ama' }) })
  if (!(await r.json()).idToken) throw new Error('The sign-in emulator gave no token')
  for (const u of ['/src/pages/chat/%5Bid%5D.vue', '/src/pages/index.vue']) { try { await fetch(`${BASE}${u}`) } catch {} }
  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' })
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

  for (const sc of SCENARIOS.filter(x => x.set === SET)) {
    note(`--- ${sc.id}`)
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await sleep(4000)
    await send(sc.prompt)
    const done = await waitForAnswer(120_000)
    await sleep(1500)
    // Scroll to where this answer starts so the trace rows are in view.
    await page.evaluate(() => { const u = [...document.querySelectorAll('main *')].filter(e => e.children.length === 0); void u })
    await shot(`${sc.id}-1-closed`)
    // Open every collapsed trace row in the chat area (not the sidebar), then shoot again.
    let opened = 0
    const rows = page.locator('button[aria-expanded="false"]')
    for (let i = 0; i < await rows.count(); i++) {
      const b = await rows.nth(i).boundingBox().catch(() => null)
      if (!b || b.x < 300 || b.y < 50 || b.y > 740) continue
      try { await rows.nth(i).click({ timeout: 1500 }); opened++; await sleep(300) } catch {}
    }
    await sleep(700)
    await shot(`${sc.id}-2-open`)
    const text = await page.evaluate(() => document.body.innerText)
    note(`${sc.id}: finished=${done} rowsOpened=${opened} chars=${text.length}`)
    note(redact(text.split('\n').filter(l => /error|could not|unavailable|rate limit|went wrong|try again|reached/i.test(l)).slice(0, 4).join(' | ')))
    // Groq's free plan allows about 8,000 tokens a minute; let the minute pass.
    await sleep(65_000)
  }
} catch (err) {
  note(`FAILED: ${redact(err?.message || err)}`)
  if (page) await shot('99-where-it-stopped')
  process.exitCode = 1
} finally {
  writeFileSync(`${OUT}/notes.txt`, notes.join('\n'))
  writeFileSync(`${OUT}/server-log.txt`, redact(serverLog).slice(-60_000))
  if (browser) await browser.close().catch(() => {})
  stop()
}
