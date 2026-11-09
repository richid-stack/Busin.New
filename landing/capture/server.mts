/**
 * Runs the REAL OpenLobs front end and the REAL server routes on this machine, on an in-memory database that is
 * filled with sample content, so the product can be filmed and photographed without anyone's account.
 *
 *  - The pages, components, styles and server code are the app's own. Nothing is redrawn.
 *  - What is sample: the person (Ama), the chats, agents, tasks and so on that are put into the database
 *    (see seed.mts), and the model's words in a live chat (a scripted model, see model.mts). Tools that run
 *    (calculator, plan, charts) run for real; connected apps (GitHub, Slack) are not connected, so their
 *    traces are stored sample messages.
 *  - It is for capture only. It is never part of the app or its deploy.
 *
 *    npx tsx landing/capture/server.mts        (serves http://localhost:3000)
 */
import http from 'node:http'
import { createServer as createVite } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueRouter from 'vue-router/vite'
import vueLayouts from 'vite-plugin-vue-layouts'
import ui from '@nuxt/ui/vite'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const PORT = Number(process.env.CAPTURE_PORT || 3000)

// The app asks Composio which accounts the person has connected. There is no Composio account here, so this one
// question is answered with a sample list; nothing else about integrations is changed.
process.env.COMPOSIO_API_KEY ||= 'capture-only'
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (/backend\.composio\.dev\/api\/v3(\.1)?\/connected_accounts(\?|$)/.test(url) && (init?.method ?? 'GET') === 'GET') {
    const item = (id: string, slug: string, name: string, who: string) => ({
      id, user_id: 'ama', status: 'ACTIVE', status_reason: null, is_disabled: false, toolkit: { slug }, word_id: null, alias: null,
      auth_config: { id: `ac_${slug}`, auth_scheme: 'OAUTH2', is_composio_managed: true, is_disabled: false },
      params: { user_info: { name: who } }, data: {}, state: null, test_request_endpoint: '',
      created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z'
    })
    return new Response(JSON.stringify({ items: [
      item('c1', 'gmail', 'Gmail', 'ama@akosua.example'), item('c2', 'slack', 'Slack', 'Akosua Interiors'), item('c3', 'github', 'GitHub', 'ama-boateng'),
      item('c4', 'googlecalendar', 'Google Calendar', 'ama@akosua.example'), item('c5', 'googledrive', 'Google Drive', 'ama@akosua.example'), item('c6', 'notion', 'Notion', 'Akosua Interiors')
    ], next_cursor: null, total_pages: 1, current_page: 1, total_items: 6 }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
}) as typeof fetch
const ROOT = process.cwd()
process.env.NODE_ENV = 'development'
process.env.REEF_ADMINS ||= 'ama@example.com'

/**
 * The one thing not the app's own: sign-in. Firebase's sign-in service is not reachable from here, so the browser
 * side is told the sample person is already signed in. Everything after that (the session, the pages, the
 * routes, the data) is the app's own code.
 */
const sampleSignIn = {
  name: 'capture-sample-sign-in',
  enforce: 'pre' as const,
  resolveId(id: string) { if (id === 'firebase/auth') return '\0capture-firebase-auth' },
  load(id: string) {
    if (id === '\0capture-firebase-auth') return `
      const user = { uid: 'ama', displayName: 'Ama Boateng', email: 'ama@example.com', photoURL: '/landing-avatar.svg', getIdToken: async () => 'ama', providerData: [{ providerId: 'google.com' }] }
      export const getAuth = () => ({ currentUser: user, authStateReady: async () => {} })
      export const onAuthStateChanged = (a, cb) => { queueMicrotask(() => cb(user)); return () => {} }
      const no = async () => ({ user })
      export const signInWithPopup = no, signInWithEmailAndPassword = no, createUserWithEmailAndPassword = no, updateProfile = async () => {}, signOut = async () => {}, sendPasswordResetEmail = async () => {}, reauthenticateWithPopup = no, reauthenticateWithCredential = no
      export class GoogleAuthProvider {}
      export class GithubAuthProvider {}
      export const EmailAuthProvider = { credential: () => ({}) }
    `
    if (id.endsWith('/src/lib/firebase.ts')) return `
      import { getAuth } from 'firebase/auth'
      export const auth = getAuth()
      export const db = {}
      export default {}
    `
  }
}

const vite = await createVite({
  root: ROOT,
  configFile: false,
  appType: 'spa',
  server: { middlewareMode: true, hmr: false, allowedHosts: ['localhost', '127.0.0.1'] },
  optimizeDeps: { holdUntilCrawlEnd: true },
  plugins: [
    sampleSignIn,
    vueRouter({ dts: false }),
    vueLayouts(),
    vue(),
    ui({ prose: true, ui: { colors: { primary: 'blue', neutral: 'zinc' } } })
  ]
})

// ---- The API: every route file under server/routes/api, called the way the tests call them ----
const { H3Event } = await vite.ssrLoadModule('nitro/h3') as any
const fire = await vite.ssrLoadModule('/server/utils/firebaseAdmin.ts') as any
const { createFakeFirestore } = await vite.ssrLoadModule('/tests/fakeFirestore.ts') as any
const db = createFakeFirestore()
fire.useFirebaseDbForTests(db)
fire.useFirebaseAuthForTests({
  verifyIdToken: async (token: string) => ({ uid: token, name: 'Ama Boateng', email: 'ama@example.com', picture: '/landing-avatar.svg', exp: Date.now() / 1000 + 36000, auth_time: Date.now() / 1000 })
})
const seedMod = await vite.ssrLoadModule('/landing/capture/seed.mts') as any
await seedMod.seed(vite, db)
const modelMod = await vite.ssrLoadModule('/landing/capture/model.mts') as any
await modelMod.installScriptedModel(vite)

type Route = { method: string, parts: string[], file: string }
const routes: Route[] = []
const walk = (dir: string) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { walk(p); continue }
    const m = n.match(/^(.*?)(?:\.(get|post|put|patch|delete))?\.ts$/)
    if (!m) continue
    const rel = relative(join(ROOT, 'server/routes'), p).split(sep)
    rel[rel.length - 1] = m[1]!
    const parts = rel.filter((x, i) => !(x === 'index' && i === rel.length - 1))
    routes.push({ method: (m[2] ?? '*').toUpperCase(), parts, file: '/' + relative(ROOT, p).split(sep).join('/') })
  }
}
walk(join(ROOT, 'server/routes/api'))
// Static segments beat [params]; longer beats shorter.
routes.sort((a, b) => b.parts.filter(x => !x.startsWith('[')).length - a.parts.filter(x => !x.startsWith('[')).length)

function match(method: string, path: string): { route: Route, params: Record<string, string> } | null {
  const segs = path.split('/').filter(Boolean)
  for (const route of routes) {
    if (route.method !== '*' && route.method !== method) continue
    if (route.parts.length !== segs.length) continue
    const params: Record<string, string> = {}
    let ok = true
    route.parts.forEach((p, i) => {
      const m = p.match(/^\[(?:\.\.\.)?(.+)\]$/)
      if (m) params[m[1]!] = decodeURIComponent(segs[i]!)
      else if (p !== segs[i]) ok = false
    })
    if (ok) return { route, params }
  }
  return null
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const hit = match(req.method || 'GET', url.pathname.replace(/\/$/, ''))
  if (!hit) { res.statusCode = 404; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ message: `no route ${req.method} ${url.pathname}` })); return }
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const body = Buffer.concat(chunks)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  headers.set('authorization', 'Bearer ama') // everyone filmed here is the sample person
  const request = new Request(url, { method: req.method, headers, body: body.length && !['GET', 'HEAD'].includes(req.method || 'GET') ? body : undefined })
  const event = new H3Event(request)
  event.context.params = hit.params
  try {
    const mod = await vite.ssrLoadModule(hit.route.file) as any
    const out = await mod.default(event)
    if (out instanceof Response) {
      res.statusCode = out.status
      out.headers.forEach((v, k) => res.setHeader(k, v))
      if (out.body) { const reader = out.body.getReader(); for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value) } }
      res.end(); return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(out ?? null))
  } catch (e: any) {
    res.statusCode = e.status ?? e.statusCode ?? 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ message: e.statusText ?? e.statusMessage ?? e.message, data: e.data }))
    if (res.statusCode >= 500) console.error('[capture]', req.method, url.pathname, e?.message)
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  if (url.pathname === '/landing-avatar.svg') {
    res.setHeader('content-type', 'image/svg+xml')
    res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2563eb"/><text x="32" y="42" font-family="Inter,Arial" font-size="28" font-weight="600" text-anchor="middle" fill="#fff">A</text></svg>')
    return
  }
  if (url.pathname.startsWith('/api/')) { api(req, res, url).catch((e) => { res.statusCode = 500; res.end(String(e?.message)) }); return }
  vite.middlewares(req, res, () => { res.statusCode = 404; res.end() })
})
// Loopback only: every request here is answered as the sample person, so nothing else on the network may reach it.
server.listen(PORT, '127.0.0.1', () => console.log(`capture server on http://localhost:${PORT}`))
