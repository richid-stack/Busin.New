/**
 * Runs the real app against a real model and checks a few real chats end to end:
 * a plain reply, a Word file made and then changed, and a web page.
 *
 * It needs the Firebase Auth and Firestore emulators running (see .github/workflows/live-chat-check.yml) and a model
 * key in the environment (GEMINI_API_KEY). It never prints the key. Sign-in is a real Firebase token from the emulator.
 *
 *   firebase emulators:exec --only auth,firestore --project demo-openlobs "node scripts/live-chat-check.mjs"
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const PORT = Number(process.env.LIVE_PORT || 3100)
const BASE = `http://127.0.0.1:${PORT}`
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`
const OUT = process.env.LIVE_OUT || 'live-chat-output'
const MODELS = (process.env.LIVE_MODELS || 'google/gemini-3.8-flash,google/gemini-3.5-flash,google/gemini-3.1-flash-lite').split(',')
mkdirSync(OUT, { recursive: true })

const results = []
const check = (ok, name, detail = '') => { results.push({ ok, name, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ? `(${detail})` : '') }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---- start the app ----
const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { env: { ...process.env, GOOGLE_CLOUD_PROJECT: 'demo-openlobs', NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
for (const s of [server.stdout, server.stderr]) s.on('data', d => { serverLog += d.toString(); if (serverLog.length > 200_000) serverLog = serverLog.slice(-100_000) })
const stop = () => { try { process.kill(-server.pid) } catch {} try { server.kill() } catch {} }
process.on('exit', stop)

async function waitForApp() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${BASE}/api/chats`); if (r.status < 500) return true } catch {}
    await sleep(1000)
  }
  return false
}

// ---- sign in with a real token from the Auth emulator ----
async function signIn() {
  const email = `check-${Date.now()}@example.com`
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'check-password-123', returnSecureToken: true, displayName: 'Check' }) })
  const j = await r.json()
  if (!j.idToken) throw new Error('The sign-in emulator did not give a token')
  return j.idToken
}

const api = (token, path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}) } })

/** One chat turn. Returns what the assistant said and every tool it used, read from the live stream. */
async function turn(token, model, text) {
  const created = await api(token, '/api/chats', { method: 'POST', body: JSON.stringify({ input: text }) })
  if (!created.ok) throw new Error(`could not start a chat (${created.status})`)
  const chat = await created.json()
  const res = await api(token, `/api/chats/${chat.id}`, { method: 'POST', headers: { Accept: 'text/event-stream' }, body: JSON.stringify({ model, messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text }] }] }) })
  const raw = await res.text()
  const out = { status: res.status, text: '', tools: [], errors: [], raw }
  const byCall = new Map()
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue
    const body = line.slice(5).trim()
    if (!body || body === '[DONE]') continue
    let ev; try { ev = JSON.parse(body) } catch { continue }
    if (ev.type === 'text-delta') out.text += ev.delta ?? ''
    if (ev.type === 'error') out.errors.push(String(ev.errorText ?? '').slice(0, 300))
    if (ev.type === 'tool-input-available') byCall.set(ev.toolCallId, { name: ev.toolName, input: ev.input })
    if (ev.type === 'tool-output-available') out.tools.push({ ...(byCall.get(ev.toolCallId) || {}), output: ev.output })
  }
  return { ...out, chatId: chat.id }
}

try {
  check(await waitForApp(), 'the app starts')
  const token = await signIn()
  check(true, 'sign-in works with a real token')

  // 1. Find a model that answers.
  let model = null
  let hello
  for (const m of MODELS) {
    hello = await turn(token, m, 'Reply with the single word: pong')
    if (hello.status === 200 && /pong/i.test(hello.text)) { model = m; break }
    console.log(`  ${m}: status ${hello.status}`, hello.errors[0] || hello.text.slice(0, 120))
  }
  writeFileSync(`${OUT}/plain.txt`, hello?.text || hello?.raw?.slice(0, 2000) || '')
  check(!!model, 'a plain chat gets a real answer', model || (hello?.errors[0] || `status ${hello?.status}`))
  if (!model) throw new Error('No model answered, so the rest is skipped.')

  // 2. A Word file made and then changed.
  const made = await turn(token, model, 'Make a short Word proposal for Akosua Ltd: rebuild their website in 6 weeks for GHS 24,000, with a heading called Timeline. Then change the timeline to 8 weeks.')
  writeFileSync(`${OUT}/file-turn.json`, JSON.stringify({ text: made.text, tools: made.tools.map(t => ({ name: t.name, ok: t.output?.status, version: t.output?.version })) }, null, 1))
  const create = made.tools.find(t => t.name === 'create_document')
  const edit = made.tools.find(t => t.name === 'edit_file')
  check(create?.output?.status === 'ok' && create.output.artifactId, 'the assistant makes a Word file that can be opened', create ? `status ${create.output?.status}` : 'no file made')
  check(edit?.output?.status === 'ok' && edit.output.version >= 2, 'the assistant changes one part of it', edit ? `status ${edit.output?.status} ${edit.output?.error || ''}` : 'no change made')
  if (create?.output?.artifactId) {
    const view = await (await api(token, `/api/artifacts/${create.output.artifactId}`)).json()
    check(view?.kind === 'document' && view.head >= 1, 'the file opens through the pane route', `version ${view?.head}`)
    writeFileSync(`${OUT}/file-view.json`, JSON.stringify(view, null, 1))
    const dl = await api(token, `/api/artifacts/${create.output.artifactId}/download`)
    check(dl.status === 200 && (await dl.arrayBuffer()).byteLength > 1000, 'the file downloads')
  }

  // 3. A web page.
  const page = await turn(token, model, 'Create a one-page landing page for a kente weaving studio in Bonwire with a hero, three product cards and an order button.')
  const made3 = page.tools.find(t => t.name === 'create_page')
  check(made3?.output?.status === 'ok' && made3.output.artifactId, 'the assistant makes a web page', made3 ? `status ${made3.output?.status} ${made3.output?.error || ''}` : 'no page made')
  if (made3?.output?.artifactId) {
    const view = await (await api(token, `/api/artifacts/${made3.output.artifactId}`)).json()
    writeFileSync(`${OUT}/page.html`, view?.spec?.html || '')
    check(view?.kind === 'page' && String(view.spec?.html).length > 500, 'the page opens and has content', `${String(view?.spec?.html).length} characters`)
  }
} catch (err) {
  check(false, 'the run finished', String(err?.message || err))
} finally {
  writeFileSync(`${OUT}/server-log.txt`, serverLog.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]').slice(-60_000))
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(results, null, 1))
  stop()
}
const failed = results.filter(r => !r.ok)
console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
