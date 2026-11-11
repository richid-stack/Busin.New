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
    if (await page.getByText(/GPT OSS 120B \(Groq\)/i).count()) { note('Groq model already selected'); return }
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

try {
  if (!(await waitForApp())) throw new Error('The app did not start')
  const email = `shots-${Date.now()}@example.com`
  const password = 'shots-password-123'
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true, displayName: 'Ama' }) })
  if (!(await r.json()).idToken) throw new Error('The sign-in emulator gave no token')

  // Warm the chat page so the first open does not fail while the dev server compiles it.
  for (const u of ['/src/pages/chat/%5Bid%5D.vue', '/src/pages/index.vue']) { try { await fetch(`${BASE}${u}`) } catch {} }
  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' })
  page = await ctx.newPage()
  page.on('pageerror', e => note(`page error: ${redact(e.message).slice(0, 200)}`))
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await sleep(6000)
  await shot('01-home')

  // Sign in through the real sign-in dialog.
  const opener = page.getByRole('button', { name: /sign in|log in|get started/i }).first()
  await opener.click({ timeout: 20_000 })
  await sleep(1500)
  await page.getByPlaceholder('name@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await shot('02-sign-in')
  await page.getByRole('button', { name: /^sign in$/i }).last().click()
  await sleep(6000)
  await shot('03-signed-in')

  // 1. A simple chat.
  await send('In two short sentences, what is kente cloth and where does it come from?')
  const done1 = await waitForAnswer()
  await sleep(1500)
  await shot('04-simple-chat')
  note(`simple chat finished: ${done1}`)

  // 2. A simple workflow request, in a fresh chat.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await sleep(4000)
  await send('Automate this: every time a client emails me, save their attachment to Google Drive and tell me on Slack.')
  const done2 = await waitForAnswer()
  await sleep(1500)
  await shot('05-workflow-collapsed')
  // Open the first trace row so both states are on record.
  const rows = page.locator('button[aria-expanded="false"]')
  const n = await rows.count()
  note(`collapsed rows found: ${n}`)
  for (let i = 0; i < Math.min(n, 3); i++) { try { await rows.nth(i).click({ timeout: 2000 }); await sleep(400) } catch {} }
  await sleep(800)
  await shot('06-workflow-expanded')
  note(`workflow chat finished: ${done2}`)
  note(`page text:\n${redact((await page.evaluate(() => document.body.innerText)).slice(0, 3000))}`)
} catch (err) {
  note(`FAILED: ${redact(err?.message || err)}`)
  if (page) await shot('99-where-it-stopped')
  process.exitCode = 1
} finally {
  writeFileSync(`${OUT}/notes.txt`, notes.join('\n'))
  writeFileSync(`${OUT}/server-log.txt`, redact(serverLog).slice(-40_000))
  if (browser) await browser.close().catch(() => {})
  stop()
}
