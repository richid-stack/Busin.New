import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { workbookApply } from './jobs'
import type { SheetDeps } from './jobs'

/** "bridge selftest": does spreadsheet work really function on this computer? Uses a throwaway folder and cleans up. */
export async function selfTest(deps: SheetDeps = {}): Promise<{ ok: boolean, lines: string[] }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlobs-selftest-'))
  const lines: string[] = []
  try {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sales')
    ws.addRows([['Region', 'Units', 'Price'], ['North', 10, 2.5], ['South', 4, 3], ['North', 6, 2.5], ['East', 8, 4]])
    await wb.xlsx.writeFile(path.join(dir, 'Sales.xlsx'))
    const res = await workbookApply(dir, {
      file: 'Sales.xlsx',
      ops: [
        { op: 'fill_formula', sheet: 'Sales', column: 'D', fromRow: 2, toRow: 5, formula: '=B{row}*C{row}', header: 'Revenue' },
        { op: 'summarize', source: 'Sales', groupBy: 'A', value: 'D', fn: 'sum', headerRow: 1, target: 'By region' },
        { op: 'add_chart', sheet: 'By region', type: 'column', categories: 'A2:A4', values: 'B2:B4', title: 'Revenue by region', anchor: 'D2' }
      ],
      pdf: true
    }, new AbortController().signal, deps)
    lines.push(`Program used: ${res.engine ?? 'none'}`)
    for (const c of res.checks) lines.push(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`)
    for (const w of res.warnings) lines.push(`NOTE  ${w}`)
    const pdfOk = !!res.pdf && fs.existsSync(path.join(dir, res.pdf)) && fs.statSync(path.join(dir, res.pdf)).size > 500
    lines.push(`${pdfOk ? 'PASS' : 'FAIL'}  PDF saved`)
    const ok = res.checks.every(c => c.ok) && pdfOk && res.charts === 1
    lines.push(ok ? 'Everything works.' : 'Something did not work. See the lines marked FAIL.')
    return { ok, lines }
  } catch (err: any) {
    lines.push(`FAIL  ${String(err?.message ?? err).slice(0, 300)}`)
    return { ok: false, lines }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
