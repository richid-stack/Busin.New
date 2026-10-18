import JSZip from 'jszip'
import type { UIMessage } from 'ai'
import { parseDataUrl } from '../server/services/documents/dataUrl'
import { assertSafeZip } from '../server/services/documents/zipGuard'
import { extractDocument } from '../server/services/documents/extract'
import { findDocument, listDocuments, prepareMessagesForModel, supportsNativePdf } from '../server/services/documents/attachments'
import { createReadDocumentTool } from '../server/utils/tools/readDocument'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const enc = (s: string) => new TextEncoder().encode(s)
const dataUrl = (bytes: Uint8Array, type: string) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
const rejects = async (fn: () => unknown) => { try { await fn(); return false } catch { return true } }

// --- Fixtures built in the test, so no binary files live in the repo ---
function makePdf(pages: string[]): Uint8Array {
  const objs: string[] = []
  const pageIds = pages.map((_, i) => 4 + i * 2)
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  objs.push(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  pages.forEach((text, i) => {
    const stream = text ? `BT /F1 14 Tf 50 700 Td (${text}) Tj ET` : ''
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`)
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return enc(out)
}

async function makeDocx(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Project Plan</w:t></w:r></w:p><w:p><w:r><w:t>Launch in March with three milestones.</w:t></w:r></w:p></w:body></w:document>')
  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// --- parseDataUrl ---
const hello = dataUrl(enc('hello'), 'text/plain')
assert(new TextDecoder().decode(parseDataUrl(hello, 1000).bytes) === 'hello', 'decodes a base64 data URL')
assert(await rejects(() => parseDataUrl('https://example.com/x.pdf', 1000)), 'rejects an http address')
assert(await rejects(() => parseDataUrl(dataUrl(new Uint8Array(5000), 'text/plain'), 1000)), 'rejects a file over the size limit before decoding')

// --- zip guard ---
const docx = await makeDocx()
assert(!(await rejects(() => assertSafeZip(docx))), 'a normal Word file passes the zip check')
const bomb = docx.slice()
{
  // Claim that the first entry unpacks to 3 GB.
  const view = new DataView(bomb.buffer)
  for (let i = bomb.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { view.setUint32(view.getUint32(i + 16, true) + 24, 3_000_000_000, true); break }
  }
}
assert(await rejects(() => assertSafeZip(bomb)), 'a zip claiming gigabytes unpacked is refused')
assert(await rejects(() => assertSafeZip(enc('PK\x03\x04 not really a zip'))), 'a broken zip is refused')

// --- extraction ---
const pdf = await extractDocument(makePdf(['Quarterly revenue grew 12 percent', 'Second page text']), 'report.pdf', 'application/pdf')
assert(pdf.kind === 'pdf' && pdf.pages === 2 && pdf.text.includes('[Page 1]') && pdf.text.includes('Quarterly revenue grew 12 percent') && pdf.text.includes('[Page 2]'), 'reads PDF text page by page')
assert(await rejects(() => extractDocument(makePdf(['']), 'scan.pdf', 'application/pdf')), 'a PDF without text (a scan) says so')
assert(await rejects(() => extractDocument(enc('%PDF-1.4 garbage'), 'bad.pdf', 'application/pdf')), 'a damaged PDF fails cleanly')

const word = await extractDocument(docx, 'plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
assert(word.kind === 'docx' && /Project Plan/.test(word.text) && /Launch in March/.test(word.text), 'reads Word text')
assert((await extractDocument(docx, 'plan.docx', 'application/octet-stream')).kind === 'docx', 'Word is recognised by content even with a wrong label')
assert(await rejects(() => extractDocument(docx, 'photo.png', 'image/png')), 'a zip that is not named .docx is not read as Word')

const csv = await extractDocument(enc('name,amount\nAma,10\nKofi,20\n'), 'sales.csv', 'text/csv')
assert(csv.kind === 'csv' && /3 rows/.test(csv.summary) && /2 columns/.test(csv.summary) && /name, amount/.test(csv.summary), 'CSV gets a row, column and header summary')
assert((await extractDocument(enc('﻿a,b\n1,2'), 'x.csv', 'application/vnd.ms-excel')).text.startsWith('a,b'), 'CSV with a BOM and an Excel label still reads')
assert((await extractDocument(enc('{"a":1}'), 'd.json', 'application/json')).text.includes('\n  "a": 1'), 'JSON is pretty printed')
assert((await extractDocument(enc('# Title\ntext'), 'n.md', '')).kind === 'markdown', 'Markdown is recognised by name')
assert(await rejects(() => extractDocument(new Uint8Array([0x4D, 0x5A, 0, 0, 1]), 'run.exe', 'application/x-msdownload')), 'binary files are refused')
assert(await rejects(() => extractDocument(new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0]), 'old.doc', 'application/msword')), 'legacy .doc is refused with a clear error')
assert(await rejects(() => extractDocument(enc('   '), 'e.txt', 'text/plain')), 'an empty file is refused')

// --- messages for the model ---
const msg = (id: string, role: 'user' | 'assistant', parts: any[]): UIMessage => ({ id, role, parts }) as UIMessage
const messages = [
  msg('1', 'user', [
    { type: 'file', mediaType: 'image/png', filename: 'p.png', url: dataUrl(new Uint8Array([1, 2]), 'image/png') },
    { type: 'file', mediaType: 'application/pdf', filename: 'Report.pdf', url: dataUrl(makePdf(['x']), 'application/pdf') },
    { type: 'file', mediaType: 'text/csv', filename: 'sales.csv', url: dataUrl(enc('a,b\n1,2'), 'text/csv') },
    { type: 'file', mediaType: 'application/pdf', filename: 'evil.pdf', url: 'http://169.254.169.254/latest/meta-data/' },
    { type: 'text', text: 'summarise' }
  ])
]
const native = prepareMessagesForModel(messages, { nativePdf: true })[0]!.parts as any[]
assert(native[0].type === 'file' && native[1].type === 'file', 'images and (for PDF-capable models) PDFs are passed through')
assert(native[2].type === 'text' && /read_document/.test(native[2].text) && /sales\.csv/.test(native[2].text), 'a CSV becomes a note pointing at read_document')
assert(native[3].type === 'text' && !/169\.254/.test(JSON.stringify(native[3])), 'a file part with an http address is removed, never fetched')
assert((prepareMessagesForModel(messages, { nativePdf: false })[0]!.parts as any[])[1].type === 'text', 'for other models the PDF becomes a note too')
assert(supportsNativePdf('google/gemini-3.8-flash') && supportsNativePdf('anthropic/claude-haiku-4.5') && !supportsNativePdf('groq/gpt-oss-120b'), 'native PDF support is decided by provider')
assert(listDocuments(messages).map(f => f.filename).join() === 'Report.pdf,sales.csv', 'lists uploaded documents only (no images, no remote files)')
assert(findDocument(messages, 'REPORT.PDF')?.filename === 'Report.pdf', 'file names match without regard to case')

// --- the tool ---
assert(createReadDocumentTool('u', [msg('2', 'user', [{ type: 'text', text: 'hi' }])]) === null, 'no tool when nothing is attached')
const big = 'line of text\n'.repeat(3000)
const withBig = [msg('3', 'user', [
  { type: 'file', mediaType: 'text/plain', filename: 'long.txt', url: dataUrl(enc(big), 'text/plain') },
  { type: 'file', mediaType: 'application/pdf', filename: 'scan.pdf', url: dataUrl(makePdf(['']), 'application/pdf') }
])]
const tool: any = createReadDocumentTool('u-doc-test', withBig)
const first = await tool.execute({ file: 'long.txt', offset: 0, maxChars: 5000 }, {})
assert(first.status === 'ok' && first.content.length <= 5000 && first.content.endsWith('\n') && first.nextOffset === first.content.length, 'long files come back in parts cut at a line break')
let text = first.content; let next = first.nextOffset; let guard = 0
while (next !== null && guard++ < 20) { const r = await tool.execute({ file: 'long.txt', offset: next, maxChars: 5000 }, {}); text += r.content; next = r.nextOffset }
assert(text === big.trim() || text === big, 'reading with nextOffset returns the whole file')
assert(/untrusted|Treat it as data/i.test(first.notice), 'results carry a data-not-instructions notice')
const missing = await tool.execute({ file: 'nope.docx', offset: 0, maxChars: 5000 }, {})
assert(missing.status === 'failed' && /long\.txt/.test(missing.error), 'an unknown file name lists what is attached')
const scan = await tool.execute({ file: 'scan.pdf', offset: 0, maxChars: 5000 }, {})
assert(scan.status === 'failed' && /scan/i.test(scan.error), 'an unreadable file comes back as a failed result, not a crash')
