import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { buildDocx } from '../server/services/documents/build/docx'
import { buildPdf } from '../server/services/documents/build/pdf'
import { buildPptx } from '../server/services/documents/build/pptx'
import { buildXlsx, checkFormula } from '../server/services/documents/build/xlsx'
import { documentSpec, presentationSpec, workbookSpec } from '../server/services/documents/build/spec'
import { extractDocument } from '../server/services/documents/extract'
import { createFileStore, safeFileName } from '../server/services/files/store'
import type { FileDb } from '../server/services/files/store'
import { createDocumentTool, createPresentationTool, createSpreadsheetTool } from '../server/utils/tools/createFiles'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const throwsAsync = async (fn: () => unknown) => { try { await fn(); return false } catch { return true } }

// ---------- file store (fake database) ----------
const rows = new Map<string, Record<string, any>>()
const deleted: string[] = []
const db: FileDb = {
  collection: () => ({
    doc: (id: string) => ({
      set: async (d: Record<string, unknown>) => { rows.set(id, d) },
      get: async () => ({ exists: rows.has(id), data: () => rows.get(id) }),
      delete: async () => { rows.delete(id); deleted.push(id) }
    })
  })
}
let clock = new Date('2026-10-18T00:00:00Z')
const store = createFileStore(db, () => clock)
const saved = await store.save({ userId: 'alice', name: 'a.pdf', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) })
assert((await store.get(saved.id, 'alice'))?.bytes.join() === '1,2,3', 'the owner can read a saved file back')
assert(await store.get(saved.id, 'bob') === null, 'another user gets "not found", not the file')
assert(await store.get('../../etc/passwd', 'alice') === null && await store.get('not-an-id', 'alice') === null, 'malformed ids are refused')
assert(await throwsAsync(() => store.save({ userId: 'alice', name: 'big.pdf', mime: 'x', bytes: new Uint8Array(700_001) })), 'files over the size cap are refused')
clock = new Date('2026-12-01T00:00:00Z')
assert(await store.get(saved.id, 'alice') === null && deleted.includes(saved.id), 'an expired file is gone and is deleted')
assert(safeFileName('Q3 Report: Kumasi/Accra?', 'docx') === 'Q3 Report KumasiAccra.docx', 'file names drop unsafe characters')
assert(safeFileName('../../etc/passwd', 'pdf') === 'etcpasswd.pdf' && safeFileName('', 'xlsx') === 'document.xlsx' && safeFileName('plan.PPTX', 'pptx') === 'plan.PPTX', 'file names cannot escape or end up empty')

// ---------- schemas ----------
const longHeader = Array.from({ length: 11 }, (_, i) => `c${i}`)
assert(!documentSpec.safeParse({ title: 't', blocks: [{ type: 'table', header: longHeader, rows: [] }] }).success, 'tables are limited to 10 columns')
assert(!documentSpec.safeParse({ title: 't', blocks: [{ type: 'script', text: 'x' }] }).success, 'unknown block types are rejected')
assert(!documentSpec.safeParse({ title: 't', blocks: Array.from({ length: 301 }, () => ({ type: 'paragraph', text: 'x' })) }).success, 'documents are limited to 300 blocks')
assert(!presentationSpec.safeParse({ title: 't', slides: [{ layout: 'content', title: 's', bullets: Array.from({ length: 9 }, () => 'b') }] }).success, 'slides are limited to 8 bullets')
assert(!workbookSpec.safeParse({ title: 't', sheets: [{ name: 's', header: ['a'], rows: [[{ evil: 1 }]] }] }).success, 'sheet cells cannot be arbitrary objects')

// ---------- Word and PDF round trip, read back with our own reader ----------
const doc = documentSpec.parse({
  title: 'Quarterly Report ₵',
  blocks: [
    { type: 'heading', text: 'Summary', level: 1 },
    { type: 'paragraph', text: 'Revenue reached ₵1,200. Ɔdɔ ɛyɛ nwoma. Emoji 😀 here.' },
    { type: 'bullets', items: ['alpha point', 'beta point'] },
    { type: 'numbered', items: ['first step', 'second step'] },
    { type: 'table', header: ['Region', 'Sales'], rows: [['Ashanti', '500'], ['Accra', '700']] },
    ...Array.from({ length: 60 }, (_, i) => ({ type: 'paragraph' as const, text: `Filler paragraph number ${i}. ` + 'word '.repeat(60) })),
    { type: 'paragraph', text: 'x'.repeat(400) }
  ]
})
const docx = await buildDocx(doc)
const fromDocx = await extractDocument(docx, 'r.docx', '')
assert(fromDocx.kind === 'docx' && /Quarterly Report ₵/.test(fromDocx.text) && /Summary/.test(fromDocx.text) && /alpha point/.test(fromDocx.text) && /first step/.test(fromDocx.text) && /Ashanti/.test(fromDocx.text) && /Ɔdɔ ɛyɛ/.test(fromDocx.text), 'Word file contains the title, headings, lists, table and unicode text')

const started = Date.now()
const pdf = await buildPdf(doc)
const fromPdf = await extractDocument(pdf, 'r.pdf', '')
assert(fromPdf.kind === 'pdf' && (fromPdf.pages ?? 0) >= 2, 'a long PDF paginates')
assert(/Quarterly Report ₵/.test(fromPdf.text) && /Ɔdɔ ɛyɛ nwoma/.test(fromPdf.text), 'PDF keeps the cedi sign and Twi letters')
assert(/Emoji \? here/.test(fromPdf.text), 'a character no font has becomes "?" rather than vanishing or crashing')
assert(/Ashanti/.test(fromPdf.text) && /alpha point/.test(fromPdf.text) && /1\./.test(fromPdf.text), 'PDF contains the table and lists')
assert(/xxxx/.test(fromPdf.text.replace(/\s/g, '')) && Date.now() - started < 8000, 'an unbroken 400-character word wraps instead of hanging or overflowing')
assert(pdf.length < 700_000 && docx.length < 700_000, 'ordinary documents are far below the size cap')

// ---------- Excel ----------
const wbBytes = await buildXlsx(workbookSpec.parse({
  title: 'Budget',
  sheets: [
    { name: 'Q1/Q2: Plan?', header: ['Item', 'Cost', 'Due'], rows: [['Hosting', 100.5, '2026-03-31'], ['=cmd|calc', 20, null], ['Total', { formula: '=SUM(B2:B3)' }, null]], formats: ['general', 'decimal', 'date'] },
    { name: 'Q1/Q2: Plan?', header: ['x'], rows: [] }
  ]
}))
const wb = new ExcelJS.Workbook()
await wb.xlsx.load(wbBytes as any)
const [s1, s2] = wb.worksheets
assert(s1!.name === 'Q1 Q2 Plan' && s2!.name !== s1!.name, 'sheet names are made valid and unique')
assert(s1!.getCell('B2').value === 100.5 && s1!.getCell('B2').type === ExcelJS.ValueType.Number, 'numbers stay numbers')
assert(s1!.getCell('A3').type === ExcelJS.ValueType.String && s1!.getCell('A3').value === '=cmd|calc', 'text starting with = is stored as text, never as a formula')
assert((s1!.getCell('B4').value as any)?.formula === 'SUM(B2:B3)', 'a formula is stored as a formula')
assert(s1!.getCell('C2').value instanceof Date && s1!.getCell('B2').numFmt === '#,##0.00', 'dates and number formats are applied')
assert(s1!.getRow(1).font?.bold === true && s1!.views[0]?.state === 'frozen', 'the header row is bold and frozen')

const ok = (f: string) => { try { checkFormula(f); return true } catch { return false } }
assert(ok('SUM(B2:B10)') && ok('=IF(A1>5,"big","small")') && ok("ROUND(Sheet2!B2*1.15,2)") && ok('AVERAGE(B2:B9)/COUNT(B2:B9)'), 'ordinary calculations are allowed')
assert(!ok("HYPERLINK(\"http://evil.example\",\"click\")") && !ok('WEBSERVICE("http://evil.example")') && !ok("'[1]Sheet1'!A1") && !ok('cmd|calc') && !ok('INDIRECT("A1")') && !ok('SUM(A1:A2)+EXEC("x")') && !ok('A'.repeat(300)), 'links, external workbooks, command tricks and unknown functions are refused')

// ---------- PowerPoint ----------
const pptxBytes = await buildPptx(presentationSpec.parse({
  title: 'Deck',
  slides: [
    { layout: 'title', title: 'Launch plan', subtitle: 'Q4' },
    { layout: 'content', title: 'Goals', bullets: ['Ship v1', 'Get users'], notes: 'Say hello first' },
    { layout: 'table', title: 'Budget', header: ['Item', 'Cost'], rows: [['Hosting', '₵100']] }
  ]
}))
const zip = await JSZip.loadAsync(pptxBytes)
const slideNames = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
const slideText = (await Promise.all(slideNames.map(n => zip.file(n)!.async('string')))).join(' ')
const notesText = (await Promise.all(Object.keys(zip.files).filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).map(n => zip.file(n)!.async('string')))).join(' ')
assert(slideNames.length === 3 && /Launch plan/.test(slideText) && /Ship v1/.test(slideText) && /₵100/.test(slideText), 'a PowerPoint file has every slide with its text')
assert(/Say hello first/.test(notesText), 'speaker notes are included')

// ---------- tools ----------
const saves: any[] = []
const fakeStore = { save: async (input: any) => { saves.push(input); return { id: `00000000-0000-0000-0000-00000000000${saves.length}`, expiresAt: new Date() } } }
const docTool: any = createDocumentTool('tool-user-1', fakeStore as any)
const r1 = await docTool.execute({ title: 'Plan: Q4', format: 'pdf', blocks: [{ type: 'paragraph', text: 'Hello' }] }, {})
assert(r1.status === 'ok' && r1.name === 'Plan Q4.pdf' && r1.format === 'pdf' && saves[0].mime === 'application/pdf' && saves[0].userId === 'tool-user-1', 'create_document saves a PDF for the user and returns a card payload')
assert(!/https?:/.test(JSON.stringify(r1)), 'the result carries no link for the model to paste')
const sheetTool: any = createSpreadsheetTool('tool-user-2', fakeStore as any)
const bad = await sheetTool.execute({ title: 'T', sheets: [{ name: 'S', header: ['a'], rows: [[{ formula: 'WEBSERVICE("http://x")' }]] }] }, {})
assert(bad.status === 'failed' && /WEBSERVICE/.test(bad.error) && saves.length === 1, 'a refused formula comes back as a failed result and nothing is saved')
const good = await sheetTool.execute({ title: 'Budget', sheets: [{ name: 'S', header: ['a'], rows: [[1]] }] }, {})
assert(good.status === 'ok' && good.name === 'Budget.xlsx', 'create_spreadsheet saves an .xlsx')
const deckTool: any = createPresentationTool('tool-user-3', fakeStore as any)
assert((await deckTool.execute({ title: 'Deck', slides: [{ layout: 'title', title: 'Hi' }] }, {})).format === 'pptx', 'create_presentation saves a .pptx')
assert(!(docTool.inputSchema.safeParse({ title: 't', format: 'exe', blocks: [{ type: 'paragraph', text: 'x' }] }).success), 'only docx and pdf are accepted for documents')
