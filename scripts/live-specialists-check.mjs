/**
 * Runs the real app against a real model and checks OpenLobs' specialists and learning suggestions end to end:
 * a research job handed to Chameleon, a plain question that must not be handed over, and a correction that should
 * be offered back as a suggestion which is then saved and undone.
 *
 * It needs the Firebase Auth and Firestore emulators running (see .github/workflows/live-specialists-check.yml) and a model
 * key in the environment (GEMINI_API_KEY). It never prints the key. Sign-in is a real Firebase token from the emulator.
 *
 *   firebase emulators:exec --only auth,firestore --project demo-openlobs "node scripts/live-specialists-check.mjs"
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const PORT = Number(process.env.LIVE_PORT || 3100)
const BASE = `http://127.0.0.1:${PORT}`
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`
const OUT = process.env.LIVE_OUT || 'live-specialists-output'
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
  const out = { status: res.status, text: '', tools: [], errors: [], raw, events: [] }
  const byCall = new Map()
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue
    const body = line.slice(5).trim()
    if (!body || body === '[DONE]') continue
    let ev; try { ev = JSON.parse(body) } catch { continue }
    if (ev.type === 'text-delta') { out.text += ev.delta ?? ''; out.events.push({ t: 'text', n: (ev.delta ?? '').length }) }
    if (ev.type === 'error') out.errors.push(String(ev.errorText ?? '').slice(0, 300))
    if (ev.type === 'tool-input-available') { byCall.set(ev.toolCallId, { name: ev.toolName, input: ev.input }); out.events.push({ t: 'call', name: ev.toolName, input: ev.input, textBefore: out.text }) }
    if (ev.type === 'tool-output-available') { out.tools.push({ ...(byCall.get(ev.toolCallId) || {}), output: ev.output }); out.events.push({ t: 'result', name: byCall.get(ev.toolCallId)?.name, output: ev.output }) }
  }
  return { ...out, chatId: chat.id }
}

// What a Chameleon step may use: its own tool groups plus the chat's shared tools (see server/services/specialists/handoff.ts).
const CHAMELEON = new Set(['web_search', 'web_fetch', 'github_read', 'community_search', 'find_skill', 'load_external_skill', 'install_skill', 'load_skill', 'read_workspace_file', 'save_to_notes', 'update_where_we_are', 'report_back'])

try {
  check(!!(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY), 'a model key is set')
  check(await waitForApp(), 'the app starts')
  const token = await signIn()
  check(true, 'sign-in works with a real token')
  if (!providers.length) throw new Error('No model key is set, so there is nothing to chat with.')

  for (const provider of providers) {
    const tag = provider
    let model = null
    let hello
    for (const m of MODELS.filter(m => m.startsWith(`${provider}/`))) {
      hello = await turn(token, m, 'Reply with the single word: pong')
      if (hello.status === 200 && /pong/i.test(hello.text)) { model = m; break }
      console.log(`  ${m}: status ${hello.status}`, (hello.errors[0] || hello.text || hello.raw).slice(0, 160).replace(/\s+/g, ' '))
      await sleep(15000)
    }
    check(!!model, `[${tag}] a plain chat gets a real answer`, model || `status ${hello?.status}`)
    if (!model) continue

    // 1. A research job the person names for Chameleon.
    const job = await turn(token, model, 'Use your researcher agent Chameleon for this. Find out what the Nuxt UI library is and who maintains it, and tell me in three sentences.')
    writeFileSync(`${OUT}/${tag}-handoff.json`, JSON.stringify({ text: job.text, events: job.events.map(e => e.t === 'text' ? { t: 'text', n: e.n } : { ...e, textBefore: undefined, output: e.output ? JSON.stringify(e.output).slice(0, 300) : undefined }) }, null, 1))
    show(`${tag} handoff: what the assistant said`, job.text || '(nothing)', 1200)
    const calls = job.events.filter(e => e.t === 'call').map(e => e.name)
    console.log(`  ${tag} tool order:`, calls.join(' > ') || '(none)')
    // Small free plans (Groq) are given only the tools a message is about, so the specialists are not offered there on purpose.
    const lean = provider === 'groq'
    const handIdx = job.events.findIndex(e => e.t === 'call' && e.name === 'hand_to_specialist')
    const handed = job.events.find(e => e.t === 'result' && e.name === 'hand_to_specialist')
    if (lean) check(handIdx < 0, `[${tag}] a small free plan is not offered specialists (it gets lean tools)`, calls.join(', ') || 'no tools')
    else check(handIdx >= 0 && handed?.output?.status === 'handed' && handed.output.specialist === 'chameleon', `[${tag}] the assistant hands the job to Chameleon`, handIdx < 0 ? `tools used: ${calls.join(', ') || 'none'}` : `status ${handed?.output?.status} ${handed?.output?.error || ''}`)
    if (!lean && handIdx >= 0) {
      check(/chameleon/i.test(job.events[handIdx].textBefore || ''), `[${tag}] it tells the person which agent it is using, before handing over`, (job.events[handIdx].textBefore || '').slice(0, 120).replace(/\s+/g, ' '))
      const reportIdx = job.events.findIndex((e, i) => i > handIdx && e.t === 'call' && e.name === 'report_back')
      const between = job.events.slice(handIdx + 1, reportIdx < 0 ? undefined : reportIdx)
      const used = between.filter(e => e.t === 'call').map(e => e.name)
      check(reportIdx >= 0, `[${tag}] Chameleon reports back`, reportIdx < 0 ? 'it never called report_back' : '')
      check(used.length > 0 && used.every(n => CHAMELEON.has(n)), `[${tag}] Chameleon uses only its own tools`, used.join(', ') || 'no tools used')
      const chatter = between.filter(e => e.t === 'text').reduce((n, e) => n + e.n, 0)
      console.log(`  ${tag} words Chameleon wrote to the person: ${chatter} characters`)
      check(chatter < 200, `[${tag}] Chameleon stays quiet and lets the lead speak`, `${chatter} characters`)
      const after = job.events.slice(reportIdx + 1).filter(e => e.t === 'text').reduce((n, e) => n + e.n, 0)
      check(reportIdx >= 0 && after > 80, `[${tag}] the lead answers the person after the report`, `${after} characters`)
    }

    // 2. A plain question must not be handed over.
    const plain = await turn(token, model, 'What is 12 times 12? Answer with just the number.')
    const plainCalls = plain.events.filter(e => e.t === 'call').map(e => e.name)
    check(plain.status === 200 && /144/.test(plain.text) && !plainCalls.includes('hand_to_specialist'), `[${tag}] a plain question is answered without handing over`, plainCalls.join(', ') || 'no tools')

    // 3. A correction is offered back, then saved and undone.
    const fix = await turn(token, model, 'No, that is too long. From now on keep every answer to three short bullet points.')
    const prop = fix.tools.find(t => t.name === 'propose_learning')
    show(`${tag} correction: what the assistant said`, fix.text || '(nothing)', 600)
    if (prop) console.log(`  ${tag} proposal input:`, JSON.stringify(prop.input), '->', JSON.stringify(prop.output).slice(0, 300))
    check(prop?.output?.status === 'proposed', `[${tag}] a correction is offered back as a suggestion`, prop ? `status ${prop.output?.status} ${prop.output?.error || ''}` : `tools used: ${fix.tools.map(t => t.name).join(', ') || 'none'}`)
    if (prop?.output?.status === 'proposed') {
      console.log(`  ${tag} suggestion:`, JSON.stringify({ text: prop.output.text, evidence: prop.output.evidence }))
      const before = await (await api(token, '/api/memory')).json()
      check(!JSON.stringify(before).includes(prop.output.text), `[${tag}] nothing is saved before the person presses Save`)
      const saved = await api(token, '/api/learning', { method: 'POST', body: JSON.stringify({ kind: 'memory', text: prop.output.text }) })
      const savedBody = await saved.json().catch(() => ({}))
      check(saved.status === 200 && savedBody.id, `[${tag}] Save keeps it in memory`, `status ${saved.status}`)
      const after = await (await api(token, '/api/memory')).json()
      check(JSON.stringify(after).includes(prop.output.text), `[${tag}] it shows up in the memory list`)
      const undone = await api(token, `/api/learning/${savedBody.id}`, { method: 'DELETE', body: JSON.stringify({ kind: 'memory' }) })
      const gone = await (await api(token, '/api/memory')).json()
      check(undone.status === 200 && !JSON.stringify(gone).includes(prop.output.text), `[${tag}] Undo takes it out again`, `status ${undone.status}`)
    }
    await sleep(8000)
  }
} catch (err) {
  check(false, 'the run finished', String(err?.message || err))
} finally {
  if (results.some(r => !r.ok)) show('server log (end)', serverLog.slice(-2500), 2500)
  writeFileSync(`${OUT}/server-log.txt`, serverLog.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]').replace(/gsk_[0-9A-Za-z]{20,}/g, '[key]').slice(-60_000))
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(results, null, 1))
  stop()
}
const failed = results.filter(r => !r.ok)
console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
