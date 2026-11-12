/**
 * Opens the real app in a real browser, signs in (Google's local test emulator, no real accounts), asks a real model to build a small app
 * with the project tools, and takes screenshots of the trace, the project pane, the preview and the downloads.
 *
 *   firebase emulators:exec --only auth,firestore --project demo-openlobs "node scripts/live-build-shots.mjs"
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


async function send(text) {
  const box = page.locator('textarea').first()
  await box.click()
  await box.fill(text)
  await page.keyboard.press('Enter')
}

/** Opens every collapsed trace row in the chat column (not the sidebar or the pane). */
async function openRows() {
  let opened = 0
  const rows = page.locator('button[aria-expanded="false"]')
  for (let i = 0; i < await rows.count(); i++) {
    const b = await rows.nth(i).boundingBox().catch(() => null)
    if (!b || b.x < 280 || b.x > 700 || b.y < 50 || b.y > 760) continue
    try { await rows.nth(i).click({ timeout: 1500 }); opened++; await sleep(250) } catch {}
  }
  return opened
}

const problems = []
const check = (ok, what) => { note(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) problems.push(what) }

try {
  if (!(await waitForApp())) throw new Error('The app did not start')
  const email = `build-${Date.now()}@example.com`
  const password = 'build-password-123'
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true, displayName: 'Richie' }) })
  if (!(await r.json()).idToken) throw new Error('The sign-in emulator gave no token')
  for (const u of ['/src/pages/chat/%5Bid%5D.vue', '/src/pages/index.vue']) { try { await fetch(`${BASE}${u}`) } catch {} }
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
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await sleep(4000)

  // 1. Build something. Gemini's free plan allows 5 requests a minute, so the ask is small.
  await send('Build me a tiny tip calculator web page. Put the page in index.html and the maths in src/split.js, which index.html loads as a module. It needs a bill box, a tip percent box and shows the total. Write the files now, then tell me in one short sentence what you made.')
  const done1 = await waitForAnswer(150_000)
  await sleep(2500)
  note(`build finished=${done1}`)
  await shot('1-built-closed')
  const opened = await openRows()
  await sleep(600)
  await shot('2-built-open')
  const text1 = await page.evaluate(() => document.body.innerText)
  check(/Created/.test(text1), 'the trace says a file was Created')
  check(await page.getByText('index.html').count() > 0, 'index.html is shown')
  check(await page.getByRole('navigation', { name: 'Project files' }).count() > 0 || await page.locator('select').count() > 0, 'the project pane is open with its file list')
  note(`rows opened: ${opened}`)
  note(redact(text1.split('\n').filter(l => /error|could not|unavailable|rate limit|went wrong|try again|reached/i.test(l)).slice(0, 4).join(' | ')))

  // 2. Preview.
  try {
    await page.getByRole('tab', { name: 'Preview' }).click({ timeout: 8000 })
    await sleep(2500)
    await shot('3-preview')
    const frame = page.frameLocator('iframe[title^="Preview of"]')
    const inputs = await frame.locator('input').count()
    check(inputs >= 2, `the preview shows a working page (inputs: ${inputs})`)
    if (inputs >= 2) {
      await frame.locator('input').nth(0).fill('120')
      await frame.locator('input').nth(1).fill('10')
      await sleep(800)
      const shown = await frame.locator('body').innerText()
      note(`preview text: ${shown.replace(/\s+/g, ' ').slice(0, 160)}`)
      check(/132/.test(shown), 'the module split across two files really runs in the preview (120 + 10% = 132)')
      await shot('4-preview-used')
    }
  } catch (e) { check(false, `preview: ${redact(e.message).slice(0, 160)}`) }

  // 3. Downloads.
  async function download(label, wanted) {
    try {
      await page.getByRole('button', { name: /download/i }).first().click({ timeout: 6000 })
      await sleep(700)
      if (label === 'Project') await shot('5-download-menu')
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), page.getByText(wanted, { exact: false }).first().click({ timeout: 6000 })])
      const path = await dl.path()
      const size = (await import('node:fs')).statSync(path).size
      check(size > 100, `${label} downloads (${dl.suggestedFilename()}, ${size} bytes)`)
      return path
    } catch (e) { check(false, `${label} download: ${redact(e.message).slice(0, 160)}`) }
  }
  const zipPath = await download('Project', 'Project (.zip)')
  const htmlPath = await download('Single page', 'Single page (.html)')
  try {
    const { readFileSync } = await import('node:fs')
    if (zipPath) check(readFileSync(zipPath).subarray(0, 2).toString() === 'PK', 'the project download is a zip file')
    if (htmlPath) { const h = readFileSync(htmlPath, 'utf8'); check(!/src=["']src\/split\.js/.test(h) && /<script>/.test(h), 'the single page has the script inside') }
  } catch (e) { check(false, `reading downloads: ${redact(e.message).slice(0, 160)}`) }

  // 4. A change in the same chat, after the minute passes. Shows what changed.
  await sleep(65_000)
  await page.getByRole('tab', { name: 'Code' }).click({ timeout: 5000 }).catch(() => {})
  await send('Change the default tip to 15 percent and add a People box so it also shows what each person pays.')
  const done2 = await waitForAnswer(150_000)
  await sleep(2500)
  note(`change finished=${done2}`)
  await shot('6-changed-closed')
  await openRows()
  await sleep(600)
  await shot('7-changed-open')
  const text2 = await page.evaluate(() => document.body.innerText)
  check(/Edited|Rewrote|Created/.test(text2), 'the second reply shows edit steps')
  check(/Changed in v2|New in v2/.test(text2), 'the pane marks what changed in version 2')
  note(redact(text2.split('\n').filter(l => /error|could not|unavailable|rate limit|went wrong|try again|reached/i.test(l)).slice(0, 4).join(' | ')))
  if (problems.length) process.exitCode = 1
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
