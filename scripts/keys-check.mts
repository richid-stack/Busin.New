/**
 * Real-key check. Calls each provider the app uses, for real, with the keys that are set as environment
 * variables (repository secrets on GitHub), and prints what came back. It never prints a key.
 * Providers whose key is not set are reported as "no key" and skipped.
 */
import { PROVIDERS } from '../server/services/web/search'
import { firecrawlScrape } from '../server/services/web/reader'
import { sendEmail } from '../server/services/email/email'
import { createFindPhotosTool } from '../server/utils/tools/findPhotos'
import { downloadToStore } from '../server/utils/tools/fetchFile'
import { safeFetch } from '../server/utils/netSafety'
import { createComposioConnectionLink, getComposioClient, listComposioUserConnections } from '../server/services/composio/client'

type Row = { name: string, status: 'ok' | 'fail' | 'no key', detail: string }
const rows: Row[] = []
const has = (k: string) => Boolean(process.env[k]?.trim())
const safe = (s: string) => s.replace(/[A-Za-z0-9_\-]{24,}/g, '[redacted]').slice(0, 220)

async function check(name: string, key: string | null, fn: () => Promise<string>) {
  if (key && !has(key)) return void rows.push({ name, status: 'no key', detail: `${key} is not set` })
  try { rows.push({ name, status: 'ok', detail: await fn() }) }
  catch (e) { rows.push({ name, status: 'fail', detail: safe((e as Error)?.message || String(e)) }) }
}

for (const p of ['parallel', 'tavily', 'firecrawl'] as const) {
  await check(`search: ${p}`, `${p.toUpperCase()}_API_KEY`, async () => {
    const hits = await PROVIDERS[p].run('who founded Mensah Labs Ghana', process.env, AbortSignal.timeout(30_000))
    if (!hits.length) throw new Error('0 results')
    return `${hits.length} results; first: ${hits[0].title.slice(0, 70)} (${new URL(hits[0].url).host})`
  })
}

await check('read a page: firecrawl', 'FIRECRAWL_API_KEY', async () => {
  const page = await firecrawlScrape('https://example.com', { apiKey: process.env.FIRECRAWL_API_KEY!.trim(), signal: AbortSignal.timeout(40_000) })
  if (!page.markdown) throw new Error('empty page')
  return `title "${page.title}", ${page.markdown.length} characters`
})

await check('email: resend (to the Resend test inbox)', 'RESEND_API_KEY', async () => {
  const r = await sendEmail(
    { to: 'delivered@resend.dev', subject: 'OpenLobs key check', html: '<p>Key check.</p>', text: 'Key check.', idempotencyKey: `keycheck-${Date.now()}` },
    { config: { apiKey: process.env.RESEND_API_KEY!.trim(), from: process.env.EMAIL_FROM?.trim() || 'OpenLobs <onboarding@resend.dev>' } }
  )
  if (!r.sent) throw new Error(r.reason || 'not sent')
  return 'accepted by Resend'
})

await check('photos: unsplash', 'UNSPLASH_ACCESS_KEY', async () => {
  const res = await fetch('https://api.unsplash.com/search/photos?query=accra%20skyline&per_page=3', { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY!.trim()}` }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`responded ${res.status}`)
  const j: any = await res.json()
  return `${j.results?.length ?? 0} photos of ${j.total} found; rate left ${res.headers.get('x-ratelimit-remaining')}`
})
await check('photos: pexels', 'PEXELS_API_KEY', async () => {
  const res = await fetch('https://api.pexels.com/v1/search?query=accra%20skyline&per_page=3', { headers: { Authorization: process.env.PEXELS_API_KEY!.trim() }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`responded ${res.status}`)
  const j: any = await res.json()
  return `${j.photos?.length ?? 0} photos of ${j.total_results} found`
})

for (const [src, key] of [['Unsplash', 'UNSPLASH_ACCESS_KEY'], ['Pexels', 'PEXELS_API_KEY'], ['Pixabay', 'PIXABAY_API_KEY']] as const) {
  await check(`find_photos tool then save one photo: ${src}`, key, async () => {
    const t: any = createFindPhotosTool('keycheck', undefined, process.env)
    const out: any = await t.execute(t.inputSchema.parse({ query: 'accra city street', orientation: 'landscape', source: src }), { toolCallId: 'k', messages: [] })
    if (out.status !== 'ok' || !out.photos?.length) throw new Error(out.error || 'no photos')
    const saved: { name?: string, bytes?: number }[] = []
    const dl: any = await downloadToStore('keycheck', out.photos[0].url, 'keycheck-photo', { fetcher: safeFetch as any, store: { save: async (f: any) => { saved.push({ name: f.name, bytes: f.bytes.length }); return { id: 'x' } }, get: async () => null } as any })
    if (!dl.ok) throw new Error(`saving the first photo failed: ${dl.error}`)
    return `${out.count} photos, credit "${out.photos[0].credit}", first saved as ${saved[0]?.name} (${Math.round((saved[0]?.bytes ?? 0) / 1024)} KB)`
  })
}

await check('composio: key accepted, tools listed', 'COMPOSIO_API_KEY', async () => {
  const client = getComposioClient()!
  const tools: any = await client.tools.getRawComposioTools({ toolkits: ['github'], limit: 5 } as any)
  const n = Array.isArray(tools) ? tools.length : (tools?.items?.length ?? 0)
  if (!n) throw new Error('no tools came back')
  return `${n} GitHub tools listed, e.g. ${(tools[0] ?? tools.items?.[0])?.slug}`
})
await check('composio: connect link for a service', 'COMPOSIO_API_KEY', async () => {
  const link = await createComposioConnectionLink('keycheck-user', 'github')
  return `connect link made (${new URL(link.redirectUrl).host})`
})
await check('composio: list a user\'s connections', 'COMPOSIO_API_KEY', async () => {
  const c = await listComposioUserConnections('keycheck-user')
  return `${c.length} connections for the test user (a fresh user has none until someone signs in)`
})

console.log('\n=== Real key check ===')
for (const r of rows) console.log(`${r.status === 'ok' ? 'OK     ' : r.status === 'fail' ? 'FAILED ' : 'NO KEY '} ${r.name} — ${r.detail}`)
const failed = rows.filter(r => r.status === 'fail').length
console.log(`\n${rows.filter(r => r.status === 'ok').length} worked, ${failed} failed, ${rows.filter(r => r.status === 'no key').length} skipped (no key)`)
process.exit(failed ? 1 : 0)
