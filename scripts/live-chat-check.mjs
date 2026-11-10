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
const MODELS = (process.env.LIVE_MODELS || 'google/gemini-3.8-flash,google/gemini-3.5-flash,google/gemini-3.1-flash-lite,groq/gpt-oss-120b,groq/gpt-oss-20b,groq/qwen3.8-27b').split(',')
const KEYS = { google: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY' }
// Only providers whose key is set are tried. For each one, the first model that answers runs the whole set of chats.
const providers = [...new Set(MODELS.map(m => m.split('/')[0]))].filter(p => process.env[KEYS[p]])
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
const redact = t => String(t).replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]').replace(/gsk_[0-9A-Za-z]{20,}/g, '[key]')
const show = (label, t, n = 1500) => console.log(`  --- ${label}\n${redact(t).slice(0, n).replace(/^/gm, '  | ')}`)
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
  for (const [p, name] of Object.entries(KEYS)) check(!!process.env[name], `the ${name} secret is set`, process.env[name] ? '' : p === 'google' ? 'add it under Settings, Secrets and variables, Actions' : 'optional, skipped')
  check(await waitForApp(), 'the app starts')
  const token = await signIn()
  check(true, 'sign-in works with a real token')
  if (!providers.length) throw new Error('No model key is set, so there is nothing to chat with.')

  for (const provider of providers) {
    const tag = provider
    // 1. Find a model of this provider that answers.
    let model = null
    let hello
    for (const m of MODELS.filter(m => m.startsWith(`${provider}/`))) {
      hello = await turn(token, m, 'Reply with the single word: pong')
      if (hello.status === 200 && /pong/i.test(hello.text)) { model = m; break }
      show(`${m} stream`, hello.raw, 1200)
      await sleep(15000)
      console.log(`  ${m}: status ${hello.status}`, (hello.errors[0] || hello.text || hello.raw).slice(0, 160).replace(/\s+/g, ' '))
    }
    writeFileSync(`${OUT}/${tag}-plain.txt`, hello?.text || hello?.raw?.slice(0, 2000) || '')
    check(!!model, `[${tag}] a plain chat gets a real answer`, model || (hello?.errors[0] || `status ${hello?.status}`))
    if (!model) continue

    // 2. A Word file made and then changed.
    const made = await turn(token, model, 'Make a short Word proposal for Akosua Ltd: rebuild their website in 6 weeks for GHS 24,000, with a heading called Timeline. Then change the timeline to 8 weeks.')
    writeFileSync(`${OUT}/${tag}-file-turn.json`, JSON.stringify({ text: made.text, tools: made.tools.map(t => ({ name: t.name, ok: t.output?.status, version: t.output?.version, error: t.output?.error })) }, null, 1))
    if (!made.tools.length) { show(`${tag} file turn: what the assistant said`, made.text || '(nothing)'); show(`${tag} file turn: stream`, made.raw, 2500) }
    const create = made.tools.find(t => t.name === 'create_document')
    const edit = made.tools.find(t => t.name === 'edit_file')
    check(create?.output?.status === 'ok' && create.output.artifactId, `[${tag}] the assistant makes a Word file that can be opened`, create ? `status ${create.output?.status}` : 'no file made')
    check(edit?.output?.status === 'ok' && edit.output.version >= 2, `[${tag}] the assistant changes one part of it`, edit ? `status ${edit.output?.status} ${edit.output?.error || ''}` : 'no change made')
    if (create?.output?.artifactId) {
      const view = await (await api(token, `/api/artifacts/${create.output.artifactId}`)).json()
      check(view?.kind === 'document' && view.head >= 1, `[${tag}] the file opens through the pane route`, `version ${view?.head}`)
      writeFileSync(`${OUT}/${tag}-file-view.json`, JSON.stringify(view, null, 1))
      const dl = await api(token, `/api/artifacts/${create.output.artifactId}/download`)
      check(dl.status === 200 && (await dl.arrayBuffer()).byteLength > 1000, `[${tag}] the file downloads`)
    }

    // 3. A web page.
    const page = await turn(token, model, 'Create a one-page landing page for a kente weaving studio in Bonwire with a hero, three product cards and an order button.')
    const made3 = page.tools.find(t => t.name === 'create_page')
    if (!made3) { show(`${tag} page turn: what the assistant said`, page.text || '(nothing)'); show(`${tag} page turn: stream`, page.raw, 2500) }
    check(made3?.output?.status === 'ok' && made3.output.artifactId, `[${tag}] the assistant makes a web page`, made3 ? `status ${made3.output?.status} ${made3.output?.error || ''}` : 'no page made')
    if (made3?.output?.artifactId) {
      const view = await (await api(token, `/api/artifacts/${made3.output.artifactId}`)).json()
      writeFileSync(`${OUT}/${tag}-page.html`, view?.spec?.html || '')
      check(view?.kind === 'page' && String(view.spec?.html).length > 500, `[${tag}] the page opens and has content`, `${String(view?.spec?.html).length} characters`)
    }
  }
} catch (err) {
  check(false, 'the run finished', String(err?.message || err))
} finally {
  if (results.some(r => !r.ok)) show('server log (end)', serverLog.slice(-4000), 4000)
  writeFileSync(`${OUT}/server-log.txt`, serverLog.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]').replace(/gsk_[0-9A-Za-z]{20,}/g, '[key]').slice(-60_000))
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(results, null, 1))
  stop()
}
const failed = results.filter(r => !r.ok)
console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
