import { createFileStore } from '../server/services/files/store'
import type { FileDb } from '../server/services/files/store'
import { createFetchFileTool, createViewImageTool, detectFile } from '../server/utils/tools/fetchFile'
import { UnsafeUrlError } from '../server/utils/netSafety'
import type { SafeFetchResult } from '../server/utils/netSafety'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

const rows = new Map<string, Record<string, any>>()
const db: FileDb = {
  collection: () => ({
    doc: (id: string) => ({
      set: async (d: Record<string, unknown>) => { rows.set(id, d) },
      get: async () => ({ exists: rows.has(id), data: () => rows.get(id) }),
      delete: async () => { rows.delete(id) }
    })
  })
}
const store = createFileStore(db)

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4])
const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
const PDF = Buffer.from('%PDF-1.7\nhello')
const HTML = Buffer.from('<!doctype html><html><body>hi</body></html>')
const ZIP = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0])

// ---------- detection: what a file is comes from its bytes, not from what the site says ----------
assert(detectFile(PNG, 'text/plain', '/a.txt')?.kind === 'image', 'a PNG is an image even when the site says text/plain')
assert(detectFile(HTML, 'image/png', '/a.png') === null, 'a web page claiming to be an image is refused')
assert(detectFile(JPG, 'image/jpeg', '/p')?.ext === 'jpg' && detectFile(PDF, '', '/x')?.ext === 'pdf', 'JPEG and PDF are recognised')
assert(detectFile(ZIP, 'application/zip', '/a.zip') === null && detectFile(ZIP, '', '/r.docx')?.ext === 'docx', 'a zip is refused unless it is a named Office file')
assert(detectFile(Buffer.from([0, 1, 2, 0, 5]), 'text/plain', '/a.txt') === null, 'a binary file claiming to be text is refused')
assert(detectFile(Buffer.from('a,b\n1,2'), 'text/csv', '/d.csv')?.kind === 'data', 'CSV is kept as data')
assert(detectFile(Buffer.from('<svg xmlns="x"></svg>'), 'image/svg+xml', '/i.svg')?.kind === 'text', 'SVG is kept but not treated as a viewable image')
assert(detectFile(Buffer.from('<script>x</script>'), 'image/svg+xml', '/i.svg') === null, 'a script claiming to be SVG is refused')

const res = (body: Buffer, over: Partial<SafeFetchResult> = {}): SafeFetchResult => ({ status: 200, url: 'https://cdn.example.com/photos/hero-shot.png', contentType: 'image/png', headers: {}, body, truncated: false, ...over })
const calls: string[] = []
let next: SafeFetchResult | Error = res(PNG)
const fetcher = async (url: string) => { calls.push(url); if (next instanceof Error) throw next; return next }
const run = (t: any, input: any) => t.execute(input, { toolCallId: 't', messages: [] })

// ---------- fetch_file ----------
const fetchTool = createFetchFileTool('alice', { store, fetcher })
const ok: any = await run(fetchTool, { url: 'https://cdn.example.com/photos/hero-shot.png' })
assert(ok.status === 'ok' && ok.kind === 'image' && ok.name === 'hero-shot.png' && ok.source === 'cdn.example.com', 'a public image is saved under a clean name')
assert((await store.get(ok.fileId, 'alice'))?.bytes.length === PNG.length && await store.get(ok.fileId, 'bob') === null, 'it is saved for the owner only')
const named: any = await run(fetchTool, { url: 'https://cdn.example.com/x', name: 'Brand logo' })
assert(named.status === 'ok' && named.name === 'Brand logo.png', 'a chosen name gets the real extension')
next = res(HTML, { contentType: 'text/html' })
const page: any = await run(fetchTool, { url: 'https://example.com/' })
assert(page.status === 'failed' && /not a file/.test(page.error), 'a web page is not saved as a file')
next = res(Buffer.alloc(10), { truncated: true })
const big: any = await run(fetchTool, { url: 'https://example.com/big.jpg' })
assert(big.status === 'failed' && /larger than/.test(big.error), 'a file over the size limit is refused with advice')
next = res(PNG, { status: 404 })
assert((await run(fetchTool, { url: 'https://example.com/gone.png' })).status === 'failed', 'a missing file is a failed result')
next = new UnsafeUrlError('That address is not allowed.')
const unsafe: any = await run(fetchTool, { url: 'http://10.0.0.1/a.png' })
assert(unsafe.status === 'failed' && /not allowed/.test(unsafe.error), 'a private address comes back as a failure the model can explain')
next = res(PNG)

// ---------- view_image ----------
const viewTool: any = createViewImageTool('alice', { store, fetcher })
const seen: any = await run(viewTool, { fileId: ok.fileId })
assert(seen.status === 'ok' && seen.mime === 'image/png' && !JSON.stringify(seen).includes('iVBOR'), 'viewing returns details only, never the picture, in the chat record')
const out: any = await viewTool.toModelOutput({ toolCallId: 't', input: {}, output: seen })
assert(out.type === 'content' && out.value.some((v: any) => v.type === 'image-data' && v.mediaType === 'image/png' && Buffer.from(v.data, 'base64').equals(PNG)), 'the model receives the actual picture')
const otherUser: any = await run(createViewImageTool('bob', { store, fetcher }), { fileId: ok.fileId })
assert(otherUser.status === 'failed', 'another user cannot view the file')
next = res(PDF, { url: 'https://example.com/a.pdf', contentType: 'application/pdf' })
const pdf: any = await run(fetchTool, { url: 'https://example.com/a.pdf' })
assert(pdf.status === 'ok' && (await run(viewTool, { fileId: pdf.fileId })).status === 'failed', 'a PDF is saved but cannot be viewed as an image')
next = res(PNG)
const byUrl: any = await run(viewTool, { url: 'https://cdn.example.com/photos/hero-shot.png' })
assert(byUrl.status === 'ok' && byUrl.fileId && byUrl.source === 'cdn.example.com', 'an image can be viewed straight from its address')
next = res(PDF, { contentType: 'application/pdf' })
assert((await run(viewTool, { url: 'https://example.com/a.pdf' })).status === 'failed', 'viewing a non-image address fails')
const failedOut: any = await viewTool.toModelOutput({ toolCallId: 't', input: {}, output: { status: 'failed', error: 'nope' } })
assert(failedOut.type === 'text' && failedOut.value === 'nope', 'a failed view tells the model why, with no picture')
rows.clear()
const gone: any = await viewTool.toModelOutput({ toolCallId: 't', input: {}, output: seen })
assert(gone.type === 'text' && /no longer/.test(gone.value), 'an expired image is explained, not crashed on')
assert(viewTool.inputSchema.safeParse({}).success === false && viewTool.inputSchema.safeParse({ fileId: 'a', url: 'https://x.example.com/a.png' }).success === false, 'exactly one of fileId or url is required')
let blocked = 0
const many: any = createViewImageTool('carol', { store, fetcher })
next = res(PNG)
for (let i = 0; i < 10; i++) { const r: any = await run(many, { url: 'https://cdn.example.com/p.png' }); if (r.status === 'failed' && /one reply/.test(r.error)) blocked++ }
assert(blocked === 2, 'no more than 8 images are viewed in one reply')
