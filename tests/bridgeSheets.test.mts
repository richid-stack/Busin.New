import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { SHEET_LIMITS, checkFormula, sheetOpSchema, sheetOpsSchema, workbookApplyInput, workbookInspectInput, workbookInspectResult, workspaceFile } from '../shared/sheetOps'
import { JOB_KINDS, JOB_PERMISSION, RESULT_SCHEMA, parseJobInput } from '../server/services/bridge/model'
import { BridgeError } from '../server/services/bridge/store'
import { WorkspaceError, listSpreadsheets, newFilePath, openWorkspace, resolveExisting } from '../bridge/workspace'
import { applyOps, OpError } from '../bridge/sheets/ops'
import { scanFeatures } from '../bridge/sheets/inspect'
import { findEngine } from '../bridge/sheets/engine'
import { workbookApply, workbookInspect, workbookList } from '../bridge/sheets/jobs'
import { selfTest } from '../bridge/sheets/selftest'
import { HANDLERS, activeKinds, defaultDeps, pair, pollOnce } from '../bridge/core'
import { startBridgeTestServer } from './helpers/bridgeTestServer.mts'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as Error } return null }
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'olb-sheets-'))
const noSignal = new AbortController().signal

// ---- Names and formulas ----
for (const bad of ['../x.xlsx', 'C:\\x.xlsx', '/etc/x.xlsx', '\\\\server\\share\\a.xlsx', 'a/./b.xlsx', 'a//b.xlsx', 'con.xlsx', 'a/b/../../c.xlsx', 'x.xlsx.', 'a<b.xlsx', '']) {
  assert(!workspaceFile.safeParse(bad).success, `refused as a file name: ${JSON.stringify(bad)}`)
}
assert(workspaceFile.safeParse('Budget.xlsx').success && workspaceFile.safeParse('2026/Budget 1.xlsx').success, 'ordinary names are fine')
assert(!workbookInspectInput.safeParse({ file: 'notes.docx' }).success && !workbookInspectInput.safeParse({ file: 'a.xlsm' }).success && workbookInspectInput.safeParse({ file: 'a.CSV' }).success, 'only .xlsx and .csv can be read')
for (const bad of ['WEBSERVICE("http://x")', 'SUM(1)+HYPERLINK("a","b")', '[Other.xlsx]Sheet1!A1', '\'C:\\x\\[b.xlsx]S\'!A1', 'CALL("a","b")', 'cmd|\' /c calc\'!A1', 'FILTERXML(A1,"//a")', 'IMAGE("http://x")', 'INFO("directory")', 'A1&"https://x"', '', 'REGISTER.ID("a","b")']) {
  assert(checkFormula(bad) !== null, `formula refused: ${bad || '(empty)'}`)
}
for (const ok of ['SUM(B2:B5)', '=IF(A1>0,"yes","")', "'My Sheet'!A1*2", 'SUMIF(A:A,"North",B:B)']) assert(checkFormula(ok) === null, `formula fine: ${ok}`)
assert(checkFormula('A'.repeat(600)) !== null, 'a very long formula is refused')

// ---- The operations list ----
assert(!sheetOpSchema.safeParse({ op: 'run_macro', name: 'x' }).success && !sheetOpSchema.safeParse({ op: 'add_sheet', name: 'X', extra: 1 }).success, 'unknown operations and extra fields are refused')
assert(!sheetOpsSchema.safeParse(Array(SHEET_LIMITS.maxOps + 1).fill({ op: 'add_sheet', name: 'X' })).success && !sheetOpsSchema.safeParse([]).success, 'between 1 and 40 steps')
assert(!sheetOpSchema.safeParse({ op: 'set_cells', sheet: 'A', cells: [{ ref: 'A1', formula: '=WEBSERVICE("x")' }] }).success, 'a dangerous formula is refused inside set_cells')
assert(!sheetOpSchema.safeParse({ op: 'add_sheet', name: 'Bad:name' }).success && !sheetOpSchema.safeParse({ op: 'set_cells', sheet: 'A', cells: [{ ref: 'a1', value: 1 }] }).success, 'sheet names and cell addresses are checked')
assert(!sheetOpSchema.safeParse({ op: 'format_range', sheet: 'A', range: 'A1:B2', numberFormat: '0;[Red]=cmd()' }).success, 'number formats cannot hide anything odd')
assert(!workbookApplyInput.safeParse({ file: 'a.xlsx', output: 'b.csv', ops: [{ op: 'add_sheet', name: 'X' }] }).success && workbookApplyInput.parse({ file: 'a.xlsx', ops: [{ op: 'add_sheet', name: 'X' }] }).acceptLosses === false, 'the new file must be .xlsx; losses are not accepted unless said')

// ---- Server side rules ----
assert(JOB_KINDS.includes('workbook_apply' as any) && JOB_PERMISSION.workbook_apply === 'excel' && JOB_PERMISSION.workbook_list === 'excel' && JOB_PERMISSION.workbook_inspect === 'excel', 'spreadsheet jobs need the excel permission')
assert((() => { try { parseJobInput('workbook_apply', { file: '../../x.xlsx', ops: [{ op: 'add_sheet', name: 'X' }] }); return false } catch { return true } })(), 'a path that escapes is refused when the job is made')
assert(!workbookInspectResult.safeParse({ file: 'a.xlsx', sizeKb: 1, sheets: [], features: { charts: 0, pivots: 0, pictures: 0, macros: false, externalLinks: 0 }, notes: [], filePath: 'C:\\x' }).success, 'a computer cannot add extra fields to a result')
assert(Object.keys(RESULT_SCHEMA).sort().join() === [...JOB_KINDS].sort().join(), 'every job kind has a result shape')

// ---- The chosen folder ----
const root = fs.realpathSync(tmp())
const outside = fs.realpathSync(tmp())
fs.writeFileSync(path.join(outside, 'secret.xlsx'), 'secret')
assert(!!(await rejects(async () => openWorkspace(null))) && !!(await rejects(async () => openWorkspace(path.join(root, 'nope')))) && !!(await rejects(async () => openWorkspace(path.parse(root).root))), 'no folder, a missing folder, or a whole drive is refused')
assert(openWorkspace(root) === root, 'a real folder is accepted')
assert(!!(await rejects(async () => resolveExisting(root, '../' + path.basename(outside) + '/secret.xlsx'))) && !!(await rejects(async () => resolveExisting(root, 'missing.xlsx'))), 'a path that leaves the folder or does not exist is refused')
// Shortcuts (links) cannot always be made without special rights on Windows; those checks run where they can.
let linked = true
try { fs.symlinkSync(path.join(outside, 'secret.xlsx'), path.join(root, 'link.xlsx')); fs.symlinkSync(outside, path.join(root, 'linkdir'), 'junction') } catch { linked = false }
if (linked) {
  assert((await rejects(async () => resolveExisting(root, 'link.xlsx'))) instanceof WorkspaceError && (await rejects(async () => resolveExisting(root, 'linkdir/secret.xlsx'))) instanceof WorkspaceError, 'a shortcut that leads outside the folder is refused')
  assert((await rejects(async () => newFilePath(root, 'linkdir/new.xlsx'))) instanceof WorkspaceError, 'a new file cannot be placed through a shortcut that leaves the folder')
} else console.log('SKIP shortcut checks (this machine does not allow making shortcuts)')
fs.writeFileSync(path.join(root, 'A.xlsx'), 'x'); fs.writeFileSync(path.join(root, '~$A.xlsx'), 'lock'); fs.writeFileSync(path.join(root, '.hidden.xlsx'), 'h'); fs.writeFileSync(path.join(root, 'notes.txt'), 't'); fs.mkdirSync(path.join(root, 'sub')); fs.writeFileSync(path.join(root, 'sub', 'B.csv'), 'a,b')
const listed = listSpreadsheets(root).files.map(f => f.name).sort()
assert(listed.join() === 'A.xlsx,sub/B.csv', 'only spreadsheets are listed; lock files, hidden files, shortcuts and other files are skipped')
assert(newFilePath(root, 'A.xlsx').rel === 'A (2).xlsx' && newFilePath(root, 'fresh/C.xlsx').rel === 'fresh/C.xlsx', 'a name that is taken gets a number; an existing file is never reused')
fs.rmSync(path.join(root, 'fresh'), { recursive: true, force: true })

// ---- Operations on a workbook in memory ----
const sample = () => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sales')
  ws.addRows([['Region', 'Units', 'Price'], ['North', 10, 2.5], ['South', 4, 3], ['North', 6, 2.5], ['East', 8, 4]])
  return wb
}
const op = (o: unknown) => sheetOpSchema.parse(o)
{
  const wb = sample()
  const out = applyOps(wb, [op({ op: 'fill_formula', sheet: 'Sales', column: 'D', fromRow: 2, toRow: 5, formula: '=B{row}*C{row}', header: 'Revenue' })])
  const ws = wb.getWorksheet('Sales')!
  assert((ws.getCell('D3').value as any).formula === 'B3*C3' && ws.getCell('D1').value === 'Revenue' && out.steps.length === 1, 'fill_formula writes a formula per row and a header')
  const w2 = sample()
  applyOps(w2, [op({ op: 'sort_rows', sheet: 'Sales', range: 'A1:C5', by: 'B', order: 'desc' })])
  assert([2, 3, 4, 5].map(r => w2.getWorksheet('Sales')!.getCell(`B${r}`).value).join() === '10,8,6,4' && w2.getWorksheet('Sales')!.getCell('A2').value === 'North' && w2.getWorksheet('Sales')!.getCell('A1').value === 'Region', 'sort_rows moves whole rows and keeps the header')
  const w3 = sample(); w3.getWorksheet('Sales')!.getCell('B3').value = null
  applyOps(w3, [op({ op: 'sort_rows', sheet: 'Sales', range: 'A1:C5', by: 'B', order: 'desc' })])
  assert(w3.getWorksheet('Sales')!.getCell('B5').value === null, 'blank cells sort last, either way')
  const w4 = sample(); w4.getWorksheet('Sales')!.getCell('D2').value = { formula: 'B2*2' } as any
  assert((await rejects(async () => applyOps(w4, [op({ op: 'sort_rows', sheet: 'Sales', range: 'A1:D5', by: 'B' })]))) instanceof OpError, 'sorting rows that hold formulas is refused, not guessed')
  const w5 = sample(); const s5 = w5.getWorksheet('Sales')!
  s5.getCell('A2').value = '  North   side '; s5.getCell('B3').value = '$1,234.50'; s5.getCell('B4').value = '(20)'
  applyOps(w5, [op({ op: 'clean_range', sheet: 'Sales', range: 'A1:C5', toNumber: true })])
  assert(s5.getCell('A2').value === 'North side' && s5.getCell('B3').value === 1234.5 && s5.getCell('B4').value === -20 && s5.getCell('A3').value === 'South', 'clean_range trims text and turns money-like text into numbers')
  const w6 = sample()
  applyOps(w6, [op({ op: 'summarize', source: 'Sales', groupBy: 'A', value: 'B', fn: 'sum', headerRow: 1, target: 'Totals' })])
  const t = w6.getWorksheet('Totals')!
  assert(['North', 'South', 'East', 'Total'].join() === [2, 3, 4, 5].map(r => t.getCell(`A${r}`).value).join() && (t.getCell('B2').value as any).formula === "SUMIF('Sales'!$A$2:$A$5,A2,'Sales'!$B$2:$B$5)", 'summarize writes live formulas for each group, with a total')
  const w7 = sample(); w7.getWorksheet('Sales')!.getCell('A6').value = '*all'
  assert((await rejects(async () => applyOps(w7, [op({ op: 'summarize', source: 'Sales', groupBy: 'A', value: 'B', headerRow: 1, target: 'T' })]))) instanceof OpError, 'a group named with a wildcard is refused, because it could match the wrong rows')
  assert((await rejects(async () => applyOps(sample(), [op({ op: 'add_sheet', name: 'sales' })]))) instanceof OpError && (await rejects(async () => applyOps(sample(), [op({ op: 'delete_sheet', name: 'Sales' })]))) instanceof OpError && (await rejects(async () => applyOps(sample(), [op({ op: 'set_cells', sheet: 'Nope', cells: [{ ref: 'A1', value: 1 }] })])))?.message.includes('"Sales"'), 'duplicate names, deleting the last sheet and unknown sheets are refused, with the sheet names offered')
  assert((await rejects(async () => applyOps(sample(), [op({ op: 'set_cells', sheet: 'Sales', cells: [{ ref: 'ZZZ1', value: 1 }] })])))?.message.includes('outside the sheet'), 'a cell past the last column is refused')
  assert(applyOps(sample(), [op({ op: 'add_chart', sheet: 'Sales', type: 'line', categories: 'A2:A5', values: 'B2:B5' })]).charts.length === 1, 'a chart is passed on to the spreadsheet program, not drawn by the file layer')
}

// ---- Whole jobs ----
const engine = await findEngine()
console.log(engine ? `(spreadsheet program found: ${engine.name})` : '(no spreadsheet program here: engine checks are skipped)')
const work = fs.realpathSync(tmp())
const write = async (name: string, wb: ExcelJS.Workbook) => { await wb.xlsx.writeFile(path.join(work, name)); return path.join(work, name) }
const salesPath = await write('Sales.xlsx', sample())
const before = sha(salesPath)
const noEngine = { engine: async () => null }

const listing = await workbookList(work, {})
assert(listing.files.some(f => f.name === 'Sales.xlsx') && listing.folder === path.basename(work), 'the folder is listed by name, never by its full path')
const seen = await workbookInspect(work, { file: 'Sales.xlsx' })
assert(seen.sheets[0]!.name === 'Sales' && seen.sheets[0]!.rows === 5 && seen.sheets[0]!.headers.join() === 'Region,Units,Price' && seen.sheets[0]!.sample.length === 4 && !seen.features.charts && workbookInspectResult.safeParse(seen).success, 'inspect describes the sheets, headers and a few rows')
assert((await rejects(() => workbookInspect(work, { file: '../x.xlsx' }))) !== null && (await rejects(() => workbookInspect(null, { file: 'Sales.xlsx' })))?.message.includes('No folder'), 'inspect refuses escaping paths, and refuses when no folder was chosen')

{
  const r = await workbookApply(work, { file: 'Sales.xlsx', ops: [{ op: 'fill_formula', sheet: 'Sales', column: 'D', fromRow: 2, toRow: 5, formula: '=B{row}*C{row}', header: 'Revenue' }] }, noSignal, noEngine)
  assert(r.output === 'Sales (OpenLobs).xlsx' && fs.existsSync(path.join(work, r.output)) && sha(salesPath) === before, 'the changes go to a new copy; the original is byte for byte the same')
  assert(r.engine === null && r.warnings.some(w => /not been calculated/.test(w)) && r.formulas === 4 && r.checks.every(c => c.ok), 'without a spreadsheet program it says so plainly, and still checks the file reopens')
  const again = await workbookApply(work, { file: 'Sales.xlsx', ops: [{ op: 'add_sheet', name: 'Notes' }] }, noSignal, noEngine)
  assert(again.output === 'Sales (OpenLobs) (2).xlsx' && fs.existsSync(path.join(work, 'Sales (OpenLobs).xlsx')), 'a second run never replaces the first copy')
  const before2 = fs.readdirSync(work).sort().join()
  const e1 = await rejects(() => workbookApply(work, { file: 'Sales.xlsx', ops: [{ op: 'add_chart', sheet: 'Sales', type: 'column', categories: 'A2:A5', values: 'B2:B5' }] }, noSignal, noEngine))
  assert(/Excel or LibreOffice/.test(e1?.message ?? '') && fs.readdirSync(work).sort().join() === before2, 'a chart request with no spreadsheet program is refused and leaves nothing behind')
  const e2 = await rejects(() => workbookApply(work, { file: 'Sales.xlsx', ops: [{ op: 'add_sheet', name: 'A' }, { op: 'delete_sheet', name: 'Missing' }] }, noSignal, noEngine))
  assert(/Step 2/.test(e2?.message ?? '') && fs.readdirSync(work).sort().join() === before2, 'a failing step names itself and nothing is saved')
  const ac = new AbortController(); ac.abort()
  assert(!!(await rejects(() => workbookApply(work, { file: 'Sales.xlsx', ops: [{ op: 'add_sheet', name: 'A' }] }, ac.signal, noEngine))) && fs.readdirSync(work).sort().join() === before2, 'a stopped job saves nothing')
  await write('Data.xlsx', sample())
  fs.writeFileSync(path.join(work, 'plain.csv'), 'Item,Cost\nPen,2\nBook,5\n')
  const c = await workbookApply(work, { file: 'plain.csv', ops: [{ op: 'fill_formula', sheet: 'plain', column: 'C', fromRow: 2, toRow: 3, formula: '=B{row}*2', header: 'Double' }] }, noSignal, noEngine).catch(e => e)
  assert(c.output === 'plain (OpenLobs).xlsx' || /no sheet/.test(c.message), 'a CSV file becomes a new .xlsx copy')
}

if (engine) {
  const r = await workbookApply(work, {
    file: 'Sales.xlsx',
    output: 'Report.xlsx',
    ops: [
      { op: 'fill_formula', sheet: 'Sales', column: 'D', fromRow: 2, toRow: 5, formula: '=B{row}*C{row}', header: 'Revenue' },
      { op: 'summarize', source: 'Sales', groupBy: 'A', value: 'D', fn: 'sum', headerRow: 1, target: 'By region' },
      { op: 'format_range', sheet: 'By region', range: 'B2:B5', numberFormat: '#,##0.00', bold: true },
      { op: 'add_chart', sheet: 'By region', type: 'column', categories: 'A2:A4', values: 'B2:B4', title: 'Revenue by region' }
    ],
    pdf: true
  }, noSignal)
  assert(r.engine === engine.name && r.charts === 1 && r.errors.length === 0 && r.checks.every(c => c.ok) && r.formulas >= 8, `real ${engine.name}: recalculated, a chart drawn, no errors`)
  const done = new ExcelJS.Workbook(); await done.xlsx.readFile(path.join(work, 'Report.xlsx'))
  const t = done.getWorksheet('By region')!
  const val = (a: string) => { const v: any = t.getCell(a).value; return typeof v === 'object' ? v.result : v }
  assert(val('B2') === 40 && val('B3') === 12 && val('B4') === 32 && val('B5') === 84, 'the numbers are right (North 40, South 12, East 32, Total 84), as stored answers in the file')
  assert(fs.readFileSync(path.join(work, 'Report.pdf')).subarray(0, 4).toString() === '%PDF' && r.pdf === 'Report.pdf', 'the PDF is a real PDF next to the workbook')
  assert((await scanFeatures(path.join(work, 'Report.xlsx'))).charts === 1, 'the chart is inside the saved file')
  const lossErr = await rejects(() => workbookApply(work, { file: 'Report.xlsx', ops: [{ op: 'add_sheet', name: 'More' }] }, noSignal, engine ? { engine: async () => engine } : {}))
  assert(/lose 1 chart/.test(lossErr?.message ?? ''), 'a file with a chart will not be copied through the file layer unless the person accepts losing it')
  const ok = await workbookApply(work, { file: 'Report.xlsx', acceptLosses: true, ops: [{ op: 'add_sheet', name: 'More' }] }, noSignal)
  assert(ok.warnings.some(w => /does not have the original's 1 chart/.test(w)), 'when accepted, the loss is stated in the result')
  const bad = await workbookApply(work, { file: 'Sales.xlsx', ops: [{ op: 'set_cells', sheet: 'Sales', cells: [{ ref: 'F1', formula: '=1/0' }] }] }, noSignal)
  assert(bad.errors.length === 1 && bad.checks.some(c => !c.ok && /error/.test(c.name)), 'a formula that gives an error is reported, not hidden')
  const st = await selfTest()
  assert(st.ok, 'bridge selftest passes')
}

// ---- Through the real Bridge loop and server ----
{
  const srv = await startBridgeTestServer()
  const folder = fs.realpathSync(tmp())
  await (async () => { const wb = sample(); await wb.xlsx.writeFile(path.join(folder, 'Sales.xlsx')) })()
  const pairing = await srv.store.createPairing('alice')
  const deps = { ...defaultDeps(() => {}), sheets: noEngine }
  const cfg = await pair(srv.url, pairing.code, 'Desk', deps)
  assert(!activeKinds({ allow: ['excel'] }).includes('workbook_list') && activeKinds({ allow: ['excel'], workspace: folder }).includes('workbook_apply') && !activeKinds({ workspace: folder }).includes('workbook_list'), 'spreadsheet jobs need both the permission and a chosen folder')
  const refused = await rejects(() => srv.store.enqueue('alice', cfg.deviceId, 'workbook_list', {}))
  assert(refused instanceof BridgeError && /allow excel/.test(refused.message), 'a computer without the permission cannot be asked, and is told how to allow it')
  await pollOnce({ ...cfg, allow: ['excel'], workspace: folder }, deps, new Map())
  const j = await srv.store.enqueue('alice', cfg.deviceId, 'workbook_list', {})
  await pollOnce({ ...cfg, allow: ['excel'], workspace: folder }, deps, new Map())
  const got = await srv.store.getJob('alice', j.id)
  assert(got.status === 'done' && (got.result as any).files[0].name === 'Sales.xlsx', 'a list job goes server → Bridge → server and comes back checked')
  const a = await srv.store.enqueue('alice', cfg.deviceId, 'workbook_apply', { file: 'Sales.xlsx', ops: [{ op: 'add_sheet', name: 'Notes' }] })
  await pollOnce({ ...cfg, allow: ['excel'], workspace: folder }, deps, new Map())
  const doneJob = await srv.store.getJob('alice', a.id)
  assert(doneJob.status === 'done' && (doneJob.result as any).output === 'Sales (OpenLobs).xlsx' && fs.existsSync(path.join(folder, 'Sales (OpenLobs).xlsx')), 'an apply job saves its copy in the chosen folder')
  // A hostile server asking for a path outside the folder, or for something not allowed, is refused by the Bridge itself.
  const reports: any[] = []
  const hostile = { ...deps, fetch: (async (url: any, init: any) => {
    const p = new URL(String(url)).pathname
    if (p === '/api/bridge/poll') return new Response(JSON.stringify({ jobs: [{ id: 'h1', kind: 'workbook_inspect', input: { file: '../../etc/passwd.xlsx' } }, { id: 'h2', kind: 'workbook_apply', input: { file: 'Sales.xlsx', ops: [{ op: 'add_sheet', name: 'X' }] } }], cancel: [] }))
    reports.push({ p, body: JSON.parse(init.body) }); return new Response('{}')
  }) as any } as any
  await pollOnce({ ...cfg, allow: ['excel'], workspace: folder }, hostile, new Map())
  assert(reports.length === 2 && reports.find(r => r.p.includes('h1'))?.body.ok === false, 'the Bridge checks the path itself, whatever the server sends')
  await pollOnce({ ...cfg, allow: [], workspace: folder }, { ...hostile, fetch: (async (url: any, init: any) => { const p = new URL(String(url)).pathname; if (p === '/api/bridge/poll') return new Response(JSON.stringify({ jobs: [{ id: 'h3', kind: 'workbook_list', input: {} }], cancel: [] })); reports.push({ p, body: JSON.parse(init.body) }); return new Response('{}') }) as any }, new Map())
  assert(reports.at(-1)?.body.ok === false && /not been allowed/.test(reports.at(-1)?.body.error), 'with the permission off on the computer, the Bridge refuses even if the server asks')
  assert(Object.keys(HANDLERS).includes('workbook_apply') && !Object.keys(HANDLERS).some(k => /shell|exec|run_script|macro/.test(k)), 'there is no handler that runs a command or a macro')
  await srv.stop()
}

// ---- The source says what it does ----
const src = (f: string) => fs.readFileSync(f, 'utf8')
const bridgeFiles = fs.readdirSync('bridge', { recursive: true }).map(String).filter(f => f.endsWith('.ts')).map(f => path.join('bridge', f))
const spawners = bridgeFiles.filter(f => /child_process/.test(src(f)))
assert(spawners.map(f => f.replace(/\\/g, '/')).sort().join() === 'bridge/process.ts', 'only one file in the Bridge may start another program')
assert(!bridgeFiles.some(f => /\beval\(|new Function\(|\bshell:\s*true/.test(src(f))), 'no eval and no shell in the Bridge')
const engineSrc = src('bridge/sheets/engine.ts')
assert(!/\$\{[^}]*(job|c\.|input)/.test(engineSrc.slice(engineSrc.indexOf('EXCEL_SCRIPT'), engineSrc.indexOf('Finding and running'))), 'the fixed scripts have nothing from a job placed inside them')
assert(!bridgeFiles.some(f => /fs\.(rm|rmdir|unlink)Sync/.test(src(f)) && !/(sheets\/(jobs|selftest|engine)|cli)\.ts$/.test(f.replace(/\\/g, '/'))), 'files are removed only by the few places that clean up after themselves')

fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true })
