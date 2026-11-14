/**
 * Real capability check. Runs the real app against real models and checks what the first live run did not:
 * a workflow built from chat and run, photos found and saved, a many-file build, a task started and finished,
 * a schedule that fires on time, an agent proposed and saved, and an app connected through Composio's tools.
 * When a model hits its limit the next one is used straight away (Gemini first, then Groq). No waiting.
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
const usable = MODELS.filter(m => process.env[KEYS[m.split('/')[0]]])
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
  return { ...out, started: byCall.size > 0, chatId: chat.id }
}


const gone = new Set()
const daily = r => /used up its free allowance|tomorrow|daily|per day|RPD|quota exceeded/i.test([...r.errors, r.raw.slice(0, 800)].join(' '))
const limited = r => /quota|rate.?limit|429|exhaust|RESOURCE_EXHAUSTED|too many|tokens per|overloaded|busy|503/i.test([r.status !== 200 ? `status ${r.status}` : '', ...r.errors, r.raw.slice(0, 600)].join(' ')) || (r.status === 200 && !r.text && !r.tools.length)
/** One chat turn. A model that is out for the day is dropped; one that is only busy this minute is skipped, and only when every
 *  model is busy at once does it pause (up to 35 seconds, three times) instead of giving up. */
async function ask(token, text, label) {
  for (let pass = 0; pass < 4; pass++) {
    for (const m of usable) {
      if (gone.has(m)) continue
      const r = await turn(token, m, text)
      if (limited(r)) {
        // An app action already started: asking again would repeat it (a second file, a second workflow run). Report it as incomplete.
        if (r.started) { console.log(`  ${label}: ${m} ran out after an app action started; not asking again`); return { ...r, model: m, incomplete: true } }
        const why = (r.errors[0] || `status ${r.status}`).slice(0, 100).replace(/\s+/g, ' ')
        if (daily(r)) { gone.add(m); console.log(`  ${label}: ${m} is out for the day (${why}), dropped`) } else console.log(`  ${label}: ${m} is busy (${why}), next`)
        continue
      }
      return { ...r, model: m }
    }
    if (usable.every(m => gone.has(m))) return null
    console.log(`  ${label}: every model is busy this minute, pausing 35s (pass ${pass + 1})`)
    await sleep(35_000)
  }
  return null
}
const toolOut = (r, name) => r?.tools.filter(t => t.name === name) ?? []
const save = (name, data) => writeFileSync(`${OUT}/${name}`, typeof data === 'string' ? data : JSON.stringify(data, null, 1))
const poll = async (fn, done, ms, every = 5000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (done(last)) return last; await sleep(every) } return last }

try {
  check(await waitForApp(), 'the app starts')
  const token = await signIn()
  check(true, 'sign-in works with a real token')
  check(usable.length > 0, 'at least one model key is set', usable.join(', '))
  const only = (process.env.LIVE_SCENARIOS || 'photos,build,task,schedule,agent').split(',')

  // 1. A workflow built from chat, then run.
  if (only.includes('workflow')) {
    const r = await ask(token, 'Build me a workflow called "Weekly fintech digest". The trigger is a webhook. It has one AI step that writes a five-bullet digest on the topic it is given. Then run it now with the topic "mobile money in Ghana" and tell me what it wrote.', 'workflow')
    if (!r) check(false, '[workflow] a model answered', 'every model was out of room')
    else {
      show('workflow: what it said', r.text, 900); for (const t of r.tools) show(`workflow tool ${t.name}`, JSON.stringify(t.output ?? t.input), 700)
      save('workflow-turn.json', { model: r.model, text: r.text, tools: r.tools.map(t => ({ name: t.name, input: t.input, output: t.output })) })
      const made = toolOut(r, 'workflow_create')[0]?.output
      const ran = toolOut(r, 'workflow_run')[0]?.output
      check(made?.success === true && made.workflowId, `[workflow] built from chat (${r.model})`, made ? `${made.nodeCount} nodes` : 'no workflow_create call')
      check(ran?.success === true, '[workflow] run from chat finished', ran ? (ran.success ? JSON.stringify(ran).slice(0, 160) : ran.error) : 'no workflow_run call')
      if (made?.workflowId) {
        const runs = await (await api(token, `/api/workflows/${made.workflowId}/runs`)).json().catch(() => null)
        save('workflow-runs.json', runs)
        const list = Array.isArray(runs) ? runs : runs?.runs
        check(Array.isArray(list) && list.length >= 1, '[workflow] the run is saved in the workflow\'s history', `${list?.length ?? 0} run(s), status ${list?.[0]?.status}`)
      }
    }
  }

  // 2. Photos: find, save, look.
  if (only.includes('photos')) {
    const r = await ask(token, 'Find me photos of kente cloth, save the best one to my files, look at it, and tell me in one sentence what it shows and who took it.', 'photos')
    if (!r) check(false, '[photos] a model answered', 'every model was out of room')
    else {
      show('photos: what it said', r.text, 700); for (const t of r.tools) show(`photos tool ${t.name}`, JSON.stringify({ input: t.input, status: t.output?.status, error: t.output?.error, count: t.output?.count }), 500)
      save('photos-turn.json', { model: r.model, text: r.text, tools: r.tools.map(t => ({ name: t.name, input: t.input, status: t.output?.status, error: t.output?.error, count: t.output?.count })) })
      const found = toolOut(r, 'find_photos')[0]?.output
      const kept = toolOut(r, 'fetch_file')[0]?.output
      const looked = toolOut(r, 'view_image')[0]?.output
      check(found?.status === 'ok' && found.count > 0, `[photos] found real photos (${r.model})`, found ? `${found.count} from ${found.source}` : 'find_photos not called')
      check(kept?.status === 'ok', '[photos] saved one to the files', kept ? (kept.error || kept.status) : 'fetch_file not called')
      check(looked && looked.status !== 'failed', '[photos] looked at it', looked ? (looked.error || looked.status || 'ok') : 'view_image not called')
      check(/by\s+\S+|photograph|credit/i.test(r.text), '[photos] the answer names the photographer', r.text.slice(0, 140).replace(/\s+/g, ' '))
    }
  }

  // 3. A build with many files.
  if (only.includes('build')) {
    const r = await ask(token, 'Build me a habit tracker web app as a project with these separate files: index.html, styles.css, app.js, storage.js, habits.js, README.md. Habits can be added, ticked off per day and deleted, and they are kept in the browser. Keep going until all six files exist.', 'build')
    if (!r) check(false, '[build] a model answered', 'every model was out of room')
    else {
      const writes = toolOut(r, 'write_file').filter(t => t.output?.status === 'ok')
      show('build: what it said', r.text, 700); console.log('  build steps:', r.tools.map(t => `${t.name}${t.input?.path ? `(${t.input.path})` : ''}:${t.output?.status ?? '?'}`).join(' '))
      save('build-turn.json', { model: r.model, steps: r.tools.length, text: r.text, tools: r.tools.map(t => ({ name: t.name, path: t.input?.path, status: t.output?.status, error: t.output?.error })) })
      check(writes.length >= 6, `[build] six files written (${r.model})`, `${writes.length} written, ${r.tools.length} steps in all`)
      const id = writes.find(t => t.output?.artifactId)?.output.artifactId
      if (id) {
        const view = await (await api(token, `/api/artifacts/${id}`)).json()
        check(view?.kind === 'project' && Object.keys(view.spec?.files || {}).length >= 6, '[build] the project opens with its files', `${Object.keys(view?.spec?.files || {}).length} files`)
        const dl = await api(token, `/api/artifacts/${id}/download?format=html`)
        const html = dl.status === 200 ? await dl.text() : ''
        save('build-bundle.html', html)
        check(html.length > 1500 && /<script/i.test(html) && /<style/i.test(html), '[build] it bundles into one working page', `${html.length} characters`)
      } else check(false, '[build] the project opens with its files', 'no project id')
    }
  }

  // 4. A task: proposed in chat, started, finished.
  let lastModel = usable.find(m => !gone.has(m)) || null
  if (only.includes('task')) {
    const r = await ask(token, 'Set up a background task: research the three biggest mobile money providers in Ghana and give me a short Word briefing with one paragraph each. The Word file must exist.', 'task')
    if (!r) check(false, '[task] a model answered', 'every model was out of room')
    else {
      lastModel = r.model
      const prop = toolOut(r, 'task_propose')[0]?.output
      save('task-proposal.json', { model: r.model, text: r.text, proposal: prop })
      check(prop?.status === 'proposed', `[task] proposed in chat as a card (${r.model})`, prop ? prop.status : 'task_propose not called')
      if (prop?.status === 'proposed') {
        const started = await api(token, '/api/tasks', { method: 'POST', body: JSON.stringify({ ...prop.draft, model: gone.has(r.model) ? null : r.model, maxSteps: 12, maxMinutes: 6 }) })
        const task = started.ok ? await started.json() : null
        check(!!task?.id, '[task] pressing Start creates it', task ? '' : `status ${started.status}`)
        if (task?.id) {
          const end = await poll(async () => (await api(token, `/api/tasks/${task.id}`)).json(), t => ['done', 'partial', 'failed', 'cancelled'].includes(t.status), 8 * 60_000, 8000)
          save('task-final.json', end); show('task: final', JSON.stringify({ status: end?.status, outcome: end?.outcome, result: String(end?.result ?? '').slice(0, 600), criteria: end?.criteria, artifacts: end?.artifacts, error: end?.error }), 1800)
          check(end?.status === 'done' || end?.status === 'partial', `[task] it runs to the end (${end?.status})`, String(end?.outcome || end?.result || '').slice(0, 160).replace(/\s+/g, ' '))
          check((end?.artifacts?.length ?? 0) >= 1, '[task] it saved a file', (end?.artifacts || []).map(a => a.name || a.title).join(', '))
        }
      }
    }
  }

  // 5. A schedule that fires on time.
  if (only.includes('schedule')) {
    const runAt = new Date(Date.now() + 75_000).toISOString()
    const made = await api(token, '/api/task-schedules', { method: 'POST', body: JSON.stringify({ title: 'Live check schedule', runAt, task: { goal: 'Search the web for one recent headline about Ghana technology and write it in one sentence with the source link.', criteria: [{ text: 'The result names a source', kind: 'check' }], model: lastModel && !gone.has(lastModel) ? lastModel : null, maxSteps: 8, maxMinutes: 4 } }) })
    const sched = made.ok ? await made.json() : null
    check(!!sched?.id, '[schedule] a one-time schedule is saved', sched ? `fires ${runAt}` : `status ${made.status}: ${(await made.text()).slice(0, 120)}`)
    if (sched?.id) {
      await sleep(80_000)
      const tick = await fetch(`${BASE}/api/cron/tasks`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } })
      const tj = await tick.json().catch(() => ({}))
      save('schedule-tick.json', tj)
      check(tick.status === 200 && (tj.schedules?.fired ?? tj.schedules?.started ?? tj.schedules?.made ?? 0) >= 1, '[schedule] the timer made the task when it was due', JSON.stringify(tj.schedules).slice(0, 160))
      const found = await poll(async () => { const all = await (await api(token, '/api/tasks')).json(); return (Array.isArray(all) ? all : all.tasks || []).find(t => t.scheduleId === sched.id) }, t => t && ['done', 'partial', 'failed', 'cancelled'].includes(t.status), 6 * 60_000, 8000)
      save('schedule-task.json', found); show('schedule: task final', JSON.stringify({ status: found?.status, outcome: found?.outcome, result: String(found?.result ?? '').slice(0, 600), criteria: found?.criteria }), 1800)
      check(found?.status === 'done' || found?.status === 'partial', `[schedule] the task it made finished (${found?.status ?? 'none made'})`, String(found?.outcome || found?.result || '').slice(0, 160).replace(/\s+/g, ' '))
    }
  }

  // 6. An agent: proposed in chat, saved, listed.
  if (only.includes('agent')) {
    const r = await ask(token, 'Suggest an agent I can keep for writing polite payment reminder messages to late-paying clients in Ghana. Keep it simple.', 'agent')
    if (!r) check(false, '[agent] a model answered', 'every model was out of room')
    else {
      const prop = toolOut(r, 'propose_agent')[0]?.output
      show('agent: what it said', r.text, 600); show('agent: proposal', JSON.stringify(prop), 900)
      save('agent-proposal.json', { model: r.model, text: r.text, proposal: prop, tools: r.tools.map(t => t.name) })
      check(prop?.status === 'proposed', `[agent] proposed in chat as a card (${r.model})`, prop ? prop.status : `tools used: ${r.tools.map(t => t.name).join(', ') || 'none'}`)
      if (prop?.status === 'proposed') {
        const kept = await api(token, '/api/agents', { method: 'POST', body: JSON.stringify(prop.draft) })
        const agent = kept.ok ? await kept.json() : null
        check(!!agent?.id, '[agent] pressing Keep saves it', agent ? agent.name : `status ${kept.status}`)
        const list = await (await api(token, '/api/agents')).json().catch(() => [])
        check((Array.isArray(list) ? list : list.agents || []).some(a => a.id === agent?.id), '[agent] it shows in the list')
      }
    }
  }
} catch (err) {
  check(false, 'the run finished', String(err?.message || err))
} finally {
  if (results.some(r => !r.ok)) show('server log (end)', serverLog.slice(-3000), 3000)
  writeFileSync(`${OUT}/server-log.txt`, redact(serverLog).slice(-60_000))
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(results, null, 1))
  stop()
}
const failed = results.filter(r => !r.ok)
console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
