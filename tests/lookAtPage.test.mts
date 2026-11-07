import { createFileStore } from '../server/services/files/store'
import type { FileDb } from '../server/services/files/store'
import { analyzeCss, colorRole, normalizeColor, readDesignTokens } from '../server/services/design/tokens'
import { createDesignTokensTool, createLookAtPageTool } from '../server/utils/tools/lookAtPage'
import { InspectError } from '../server/services/inspect/browser'
import { UnsafeUrlError } from '../server/utils/netSafety'
import type { SafeFetchResult } from '../server/utils/netSafety'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const run = (t: any, input: any) => t.execute(input, { toolCallId: 't', messages: [] })

// ---------- colours ----------
assert(normalizeColor('#FFF') === '#ffffff' && normalizeColor('#1A2B3C') === '#1a2b3c', 'hex colours are normalised')
assert(normalizeColor('rgb(255, 0, 0)') === '#ff0000' && normalizeColor('rgba(0 128 255 / 0.5)') === '#0080ff', 'rgb colours convert, including the modern syntax')
assert(normalizeColor('hsl(0, 100%, 50%)') === '#ff0000' && normalizeColor('hsl(120deg 100% 25%)') === '#008000', 'hsl colours convert')
assert(normalizeColor('rgba(0,0,0,0)') === null && normalizeColor('#00000000') === null && normalizeColor('transparent') === null, 'see-through colours are ignored')
assert(normalizeColor('#12345') === null, 'a malformed hex is ignored')
assert(colorRole('#888888') === 'neutral' && colorRole('#ff5a1f') === 'accent', 'greys are neutral, colour is accent')

// ---------- css analysis ----------
const css = `
/* #ff00ff in a comment is not used */
:root{--brand:#ff5a1f;--radius:12px;--tw-ring:1px;--bg:rgb(250,250,250)}
body{font-family:"Inter",system-ui,sans-serif;color:#111;background:#fff;font-size:16px}
h1{font-family:'Playfair Display',serif;font-size:3rem;color:#ff5a1f}
.card{border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.12);background:#fff}
.btn{background:#FF5A1F;border-radius:999px;font-size:16px}
.x{background:url(data:image/png;base64,#abcdef);font-family:var(--f)}
`
const a = analyzeCss(css)
assert(a.colors.get('#ff5a1f') === 3 && !a.colors.has('#ff00ff') && !a.colors.has('#abcdef'), 'colours are counted; comments and url payloads are not')
assert(a.fonts.get('Inter') === 1 && a.fonts.get('Playfair Display') === 1 && !a.fonts.has('system-ui') && !a.fonts.has('var(--f)'), 'fonts are the first named family, not generics or variables')
assert(a.sizes.get('16px') === 2 && a.radii.get('12px') === 1 && a.radii.get('999px') === 1, 'sizes and radii are counted')
assert(a.variables.get('--brand') === '#ff5a1f' && a.variables.has('--radius') && !a.variables.has('--tw-ring'), 'design variables are kept, framework internals are not')
assert(a.shadows.size === 1, 'shadows are collected')

// ---------- reading a page ----------
const html = `<!doctype html><html><head><title>Kente Studio</title>
<meta name="theme-color" content="#B4531A">
<link rel="stylesheet" href="/assets/app.css?v=2">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;600">
<link rel="stylesheet" href="/assets/broken.css">
<style>.hero{color:#B4531A;font-family:"Inter"}</style></head><body></body></html>`
const calls: string[] = []
const fetcher = async (url: string): Promise<SafeFetchResult> => {
  calls.push(url)
  const ok = (body: string, ct = 'text/css'): SafeFetchResult => ({ status: 200, url, contentType: ct, headers: {}, body: Buffer.from(body), truncated: false })
  if (url === 'https://shop.example.com/') return ok(html, 'text/html')
  if (url.endsWith('app.css?v=2')) return ok(css)
  throw new Error('boom')
}
const t = await readDesignTokens('https://shop.example.com/', { fetcher })
assert(t.title === 'Kente Studio' && t.themeColor === '#b4531a', 'title and theme colour are read')
assert(t.colors[0]!.hex === '#ff5a1f' && t.colors[0]!.role === 'accent', 'the most used colour comes first')
assert(t.fonts.some(f => f.family === 'DM Serif Display') && t.fonts.some(f => f.family === 'Inter'), 'Google Fonts families are read from the link')
assert(t.stylesheets === 1 && !calls.some(c => c.includes('googleapis')), 'a stylesheet that fails is skipped, Google Fonts css is not downloaded')
const bare = await readDesignTokens('https://js.example.com/', { fetcher: async url => ({ status: 200, url, contentType: 'text/html', headers: {}, body: Buffer.from('<html><title>App</title><div id=root></div></html>'), truncated: false }) })
assert(bare.colors.length === 0 && /JavaScript/.test(bare.note), 'a page with no CSS says so and points to look_at_page')
let threw = false
await readDesignTokens('https://x.example.com/', { fetcher: async url => ({ status: 404, url, contentType: '', headers: {}, body: Buffer.alloc(0), truncated: false }) }).catch(() => { threw = true })
assert(threw, 'a missing page is an error')

// ---------- design_tokens tool ----------
const tokenTool = createDesignTokensTool('u1', fetcher as any)
const tk: any = await run(tokenTool, { url: 'https://shop.example.com/' })
assert(tk.status === 'ok' && tk.source === 'shop.example.com' && tk.colors.length > 0, 'the tool returns tokens and the source host')
const bad: any = await run(createDesignTokensTool('u1', (async () => { throw new UnsafeUrlError('That address is not allowed.') }) as any), { url: 'http://10.0.0.1/' })
assert(bad.status === 'failed' && /not allowed/.test(bad.error), 'a private address is a failure the model can explain')

// ---------- look_at_page ----------
const rows = new Map<string, any>()
const db: FileDb = { collection: () => ({ doc: (id: string) => ({ set: async (d: any) => { rows.set(id, d) }, get: async () => ({ exists: rows.has(id), data: () => rows.get(id) }), delete: async () => { rows.delete(id) } }) }) } as any
const store = createFileStore(db)
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(2000, 7)])
const seen: any[] = []
let behaviour: 'ok' | 'bigfull' | 'bigalways' | 'inspect' | 'unsafe' = 'ok'
const provider = {
  capture: async (req: any) => {
    seen.push(req)
    if (behaviour === 'inspect') throw new InspectError('The page took too long to load.')
    if (behaviour === 'unsafe') throw new UnsafeUrlError('That address is not allowed.')
    const big = behaviour === 'bigalways' || (behaviour === 'bigfull' && req.fullPage)
    return { bytes: big ? Buffer.alloc(800_000, 1) : JPG, mediaType: 'image/jpeg' as const, width: req.width ?? 1280, height: 800, url: 'https://shop.example.com/', title: 'Kente Studio' }
  }
}
const lookTool: any = createLookAtPageTool('u1', { store, provider: () => provider })
const ok: any = await run(lookTool, { url: 'https://shop.example.com/', width: 390 })
assert(ok.status === 'ok' && ok.fileId && ok.title === 'Kente Studio' && ok.source === 'shop.example.com' && !JSON.stringify(ok).includes('/9j/'), 'a look returns the file id and details, never the picture')
assert((await store.get(ok.fileId, 'u1'))?.name === 'shop.example.com 390px.jpg', 'the screenshot is kept for the user under a clear name')
const out: any = await lookTool.toModelOutput({ toolCallId: 't', input: {}, output: ok })
assert(out.type === 'content' && out.value.some((v: any) => v.type === 'image-data' && v.mediaType === 'image/jpeg'), 'the model receives the screenshot')
assert(typeof ok.notice === 'string' && /not instructions/.test(ok.notice), 'the page text is marked as untrusted')
behaviour = 'bigfull'; seen.length = 0
const retried: any = await run(lookTool, { url: 'https://shop.example.com/', fullPage: true })
assert(retried.status === 'ok' && seen.length === 2 && seen[1].fullPage === false, 'an oversize full-page shot is retried as the first screen')
behaviour = 'bigalways'
assert((await run(lookTool, { url: 'https://shop.example.com/' })).status === 'failed', 'a screenshot still too big is refused with advice')
behaviour = 'inspect'
const slow: any = await run(lookTool, { url: 'https://slow.example.com/' })
assert(slow.status === 'failed' && /too long/.test(slow.error), 'a page that will not load is a failure the model can explain')
behaviour = 'unsafe'
assert((await run(lookTool, { url: 'http://10.0.0.1/' })).status === 'failed', 'a private address is refused')
const none: any = await run(createLookAtPageTool('u2', { store, provider: () => null }), { url: 'https://shop.example.com/' })
assert(none.status === 'failed' && /design_tokens/.test(none.error), 'with no browser set up it says so and offers design_tokens')
const lim: any = createLookAtPageTool('u3', { store, provider: () => provider })
behaviour = 'ok'
let blocked = 0
for (let i = 0; i < 8; i++) { const r: any = await run(lim, { url: 'https://shop.example.com/' }); if (r.status === 'failed' && /6 pages/.test(r.error)) blocked++ }
assert(blocked === 2, 'no more than 6 pages are looked at in one reply')
