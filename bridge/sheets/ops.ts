import ExcelJS from 'exceljs'
import { SHEET_LIMITS } from '../../shared/sheetOps'
import type { SheetOp } from '../../shared/sheetOps'
import { cellText } from './inspect'

/**
 * The named operations, carried out on a workbook held in memory. Each one checks what it is about to touch and
 * says what it did in a sentence. Charts are not drawn here: a file library cannot, so they go to the engine.
 */
export class OpError extends Error {}

export interface ChartSpec { sheet: string, type: 'column' | 'bar' | 'line' | 'pie', categories: string, values: string, title: string, anchor: string }

const MAX_SHEETS = 30
const MAX_ROW = 1_048_576
const colNumber = (letters: string) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
const colLetters = (n: number) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s }
const quote = (name: string) => `'${name.replace(/'/g, '\'\'')}'`

function parseCell(ref: string): { col: number, row: number } {
  const m = /^([A-Z]{1,3})([0-9]+)$/.exec(ref)!
  const col = colNumber(m[1]!)
  const row = Number(m[2])
  if (col > 16384 || row > MAX_ROW) throw new OpError(`${ref} is outside the sheet.`)
  return { col, row }
}
function parseRange(ref: string) {
  const [a, b] = ref.split(':') as [string, string]
  const p = parseCell(a)
  const q = parseCell(b)
  const r = { c1: Math.min(p.col, q.col), r1: Math.min(p.row, q.row), c2: Math.max(p.col, q.col), r2: Math.max(p.row, q.row) }
  if ((r.c2 - r.c1 + 1) * (r.r2 - r.r1 + 1) > 200_000) throw new OpError(`${ref} is too large to change at once.`)
  return r
}

function sheetOf(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.worksheets.find(w => w.name.toLowerCase() === name.toLowerCase())
  if (!ws) throw new OpError(`There is no sheet called "${name}". The sheets are: ${wb.worksheets.map(w => `"${w.name}"`).join(', ')}.`)
  return ws
}
const hasFormula = (v: ExcelJS.CellValue) => !!v && typeof v === 'object' && !(v instanceof Date) && ('formula' in (v as any) || 'sharedFormula' in (v as any))
const withoutEquals = (f: string) => f.replace(/^=/, '')

export interface OpOutcome { steps: string[], charts: ChartSpec[], warnings: string[] }

export function applyOps(wb: ExcelJS.Workbook, ops: SheetOp[]): OpOutcome {
  const out: OpOutcome = { steps: [], charts: [], warnings: [] }
  ops.forEach((op, i) => {
    try { out.steps.push(run(wb, op, out)) } catch (err: any) {
      if (err instanceof OpError) throw new OpError(`Step ${i + 1} (${op.op}): ${err.message}`)
      throw err
    }
  })
  return out
}

function run(wb: ExcelJS.Workbook, op: SheetOp, out: OpOutcome): string {
  switch (op.op) {
    case 'set_cells': {
      const ws = sheetOf(wb, op.sheet)
      for (const c of op.cells) {
        const { col, row } = parseCell(c.ref)
        ws.getCell(row, col).value = 'formula' in c ? { formula: withoutEquals(c.formula) } as ExcelJS.CellFormulaValue : c.value
      }
      return `Set ${op.cells.length} cell${op.cells.length === 1 ? '' : 's'} on "${ws.name}".`
    }
    case 'fill_formula': {
      const ws = sheetOf(wb, op.sheet)
      if (colNumber(op.column) > 16384 || op.toRow > MAX_ROW) throw new OpError('That range is outside the sheet.')
      const headerRow = op.headerRow ?? op.fromRow - 1
      if (op.header && headerRow >= 1) ws.getCell(`${op.column}${headerRow}`).value = op.header
      for (let r = op.fromRow; r <= op.toRow; r++) ws.getCell(`${op.column}${r}`).value = { formula: withoutEquals(op.formula).replace(/\{row\}/g, String(r)) } as ExcelJS.CellFormulaValue
      return `Filled ${op.column}${op.fromRow}:${op.column}${op.toRow} on "${ws.name}" with a formula.`
    }
    case 'add_sheet': {
      if (wb.worksheets.some(w => w.name.toLowerCase() === op.name.toLowerCase())) throw new OpError(`A sheet called "${op.name}" already exists.`)
      if (wb.worksheets.length >= MAX_SHEETS) throw new OpError(`A workbook can have at most ${MAX_SHEETS} sheets here.`)
      wb.addWorksheet(op.name)
      return `Added a sheet called "${op.name}".`
    }
    case 'rename_sheet': {
      const ws = sheetOf(wb, op.from)
      if (wb.worksheets.some(w => w !== ws && w.name.toLowerCase() === op.to.toLowerCase())) throw new OpError(`A sheet called "${op.to}" already exists.`)
      ws.name = op.to
      return `Renamed "${op.from}" to "${op.to}".`
    }
    case 'delete_sheet': {
      const ws = sheetOf(wb, op.name)
      if (wb.worksheets.length === 1) throw new OpError('The last sheet cannot be deleted.')
      wb.removeWorksheet(ws.id)
      out.warnings.push(`Sheet "${op.name}" was deleted from the new copy. Formulas that used it will show errors.`)
      return `Deleted the sheet "${op.name}" from the new copy.`
    }
    case 'clean_range': {
      const ws = sheetOf(wb, op.sheet)
      const r = parseRange(op.range)
      let changed = 0
      for (let row = r.r1; row <= r.r2; row++) {
        for (let col = r.c1; col <= r.c2; col++) {
          const cell = ws.getCell(row, col)
          let v = cell.value
          if (typeof v !== 'string') continue
          const before = v
          if (op.trim) v = v.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
          if (op.toNumber) {
            const m = /^[\s$€£₵]*(-?)(\(?)([0-9][0-9,]*\.?[0-9]*|\.[0-9]+)(\)?)\s*(%?)$/.exec(v)
            // "(20)" is how accounts write a negative number; a lone bracket is not a number.
            if (m && !!m[2] === !!m[4]) { const n = Number(m[3]!.replace(/,/g, '')); if (Number.isFinite(n)) v = ((m[1] || m[2]) ? -n : n) / (m[5] ? 100 : 1) as any }
          }
          if (v !== before) { cell.value = v; changed++ }
        }
      }
      return `Cleaned ${op.range} on "${ws.name}" (${changed} cell${changed === 1 ? '' : 's'} changed).`
    }
    case 'sort_rows': {
      const ws = sheetOf(wb, op.sheet)
      const r = parseRange(op.range)
      const by = colNumber(op.by)
      if (by < r.c1 || by > r.c2) throw new OpError(`Column ${op.by} is not inside ${op.range}.`)
      const first = r.r1 + (op.hasHeader ? 1 : 0)
      if (first >= r.r2) return `Nothing to sort in ${op.range}.`
      const rows: ExcelJS.CellValue[][] = []
      for (let row = first; row <= r.r2; row++) {
        const line: ExcelJS.CellValue[] = []
        for (let col = r.c1; col <= r.c2; col++) {
          const v = ws.getCell(row, col).value
          // Moving a formula to another row changes what its references point at, so sorting such rows is refused rather than guessed.
          if (hasFormula(v)) throw new OpError(`${op.range} contains formulas, and sorting would break them. Sort a range that holds plain values.`)
          line.push(v)
        }
        rows.push(line)
      }
      const key = (line: ExcelJS.CellValue[]) => line[by - r.c1]!
      const rank = (v: ExcelJS.CellValue) => (v === null || v === undefined || v === '' ? 3 : typeof v === 'number' ? 0 : v instanceof Date ? 1 : 2)
      const sorted = rows.map((line, idx) => ({ line, idx })).sort((a, b) => {
        const ka = key(a.line); const kb = key(b.line)
        const ra = rank(ka); const rb = rank(kb)
        // Blanks always go last, in either direction.
        if (ra === 3 || rb === 3) return ra === rb ? a.idx - b.idx : ra === 3 ? 1 : -1
        let c = 0
        if (ra !== rb) c = ra - rb
        else if (ra === 0) c = (ka as number) - (kb as number)
        else if (ra === 1) c = (ka as Date).getTime() - (kb as Date).getTime()
        else c = cellText(ka).localeCompare(cellText(kb), undefined, { sensitivity: 'base', numeric: true })
        return (op.order === 'desc' ? -c : c) || a.idx - b.idx
      })
      sorted.forEach((s, n) => s.line.forEach((v, k) => { ws.getCell(first + n, r.c1 + k).value = v }))
      // The same values must still be there, only in a different order.
      const sig = (ls: ExcelJS.CellValue[][]) => ls.map(l => JSON.stringify(l)).sort().join('\n')
      if (sig(rows) !== sig(sorted.map(s => s.line))) throw new OpError('Sorting would have changed the values, so nothing was sorted.')
      return `Sorted ${op.range} on "${ws.name}" by column ${op.by} (${op.order === 'desc' ? 'high to low' : 'low to high'}).`
    }
    case 'format_range': {
      const ws = sheetOf(wb, op.sheet)
      const r = parseRange(op.range)
      for (let row = r.r1; row <= r.r2; row++) {
        for (let col = r.c1; col <= r.c2; col++) {
          const cell = ws.getCell(row, col)
          if (op.numberFormat) cell.numFmt = op.numberFormat
          if (op.bold !== undefined) cell.font = { ...(cell.font || {}), bold: op.bold }
          if (op.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${op.fill.slice(1).toUpperCase()}` } }
        }
      }
      if (op.autoWidth) {
        for (let col = r.c1; col <= r.c2; col++) {
          let widest = 8
          ws.getColumn(col).eachCell({ includeEmpty: false }, (c) => { widest = Math.max(widest, Math.min(60, cellText(c.value).length + 2)) })
          ws.getColumn(col).width = widest
        }
      }
      return `Formatted ${op.range} on "${ws.name}".`
    }
    case 'summarize': {
      const src = sheetOf(wb, op.source)
      if (wb.worksheets.some(w => w.name.toLowerCase() === op.target.toLowerCase())) throw new OpError(`A sheet called "${op.target}" already exists. Choose a new name for the summary.`)
      if (wb.worksheets.length >= MAX_SHEETS) throw new OpError(`A workbook can have at most ${MAX_SHEETS} sheets here.`)
      const g = colNumber(op.groupBy)
      const v = colNumber(op.value)
      let last = op.headerRow
      src.eachRow({ includeEmpty: false }, (_row, n) => { if (n > op.headerRow && cellText(src.getCell(n, g).value) !== '') last = Math.max(last, n) })
      if (last === op.headerRow) throw new OpError(`There is no data under row ${op.headerRow} in column ${op.groupBy}.`)
      const keys: string[] = []
      for (let n = op.headerRow + 1; n <= last; n++) {
        const k = cellText(src.getCell(n, g).value).trim()
        if (!k || keys.includes(k)) continue
        // These characters mean something special inside SUMIF-style criteria, so a group named like that cannot be matched exactly.
        if (/^[=<>]|[*?~]/.test(k)) throw new OpError(`The group "${k.slice(0, 30)}" contains characters (= < > * ? ~) that cannot be matched exactly in a summary formula.`)
        keys.push(k)
        if (keys.length > SHEET_LIMITS.maxSummaryGroups) throw new OpError(`There are more than ${SHEET_LIMITS.maxSummaryGroups} different values in column ${op.groupBy}, which is too many for one summary.`)
      }
      const ws = wb.addWorksheet(op.target)
      const label = { sum: 'Total', average: 'Average', count: 'Count', min: 'Smallest', max: 'Largest' }[op.fn]
      ws.getCell('A1').value = cellText(src.getCell(op.headerRow, g).value) || op.groupBy
      ws.getCell('B1').value = `${label} of ${cellText(src.getCell(op.headerRow, v).value) || op.value}`
      ws.getRow(1).font = { bold: true }
      const rg = `${quote(src.name)}!$${op.groupBy}$${op.headerRow + 1}:$${op.groupBy}$${last}`
      const rv = `${quote(src.name)}!$${op.value}$${op.headerRow + 1}:$${op.value}$${last}`
      const fn = { sum: 'SUMIF', average: 'AVERAGEIF', count: 'COUNTIF', min: 'MINIFS', max: 'MAXIFS' }[op.fn]
      keys.forEach((k, idx) => {
        const row = idx + 2
        ws.getCell(`A${row}`).value = /^-?[0-9]+(\.[0-9]+)?$/.test(k) ? Number(k) : k
        const f = op.fn === 'count' ? `COUNTIF(${rg},A${row})` : op.fn === 'min' || op.fn === 'max' ? `${fn}(${rv},${rg},A${row})` : `${fn}(${rg},A${row},${rv})`
        ws.getCell(`B${row}`).value = { formula: f } as ExcelJS.CellFormulaValue
      })
      if (op.fn === 'sum' || op.fn === 'count') {
        const t = keys.length + 2
        ws.getCell(`A${t}`).value = 'Total'
        ws.getCell(`B${t}`).value = { formula: `SUM(B2:B${t - 1})` } as ExcelJS.CellFormulaValue
        ws.getRow(t).font = { bold: true }
      }
      ws.getColumn(1).width = 24
      ws.getColumn(2).width = 22
      return `Made a "${op.target}" sheet: ${label.toLowerCase()} of column ${op.value} for each of ${keys.length} different values in column ${op.groupBy}, as live formulas.`
    }
    case 'add_chart': {
      const ws = sheetOf(wb, op.sheet)
      parseRange(op.categories); parseRange(op.values); parseCell(op.anchor)
      out.charts.push({ sheet: ws.name, type: op.type, categories: op.categories, values: op.values, title: op.title, anchor: op.anchor })
      return `Added a ${op.type} chart${op.title ? ` called "${op.title}"` : ''} to "${ws.name}".`
    }
  }
}

export { colLetters }
