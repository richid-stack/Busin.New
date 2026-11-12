import type { SheetCell, SheetContent } from '../types/artifacts'

const colIndex = (letters: string) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
const REF = /^\$?([A-Z]{1,2})\$?(\d{1,4})$/

/** The number a cell holds, or null when it holds something else. Formulas are worked out from the sheet. */
function numberAt(sheet: SheetContent, col: number, row: number, depth: number): number | null {
  const cell = row === 0 ? sheet.header[col] : sheet.rows[row - 1]?.[col]
  if (typeof cell === 'number') return cell
  if (cell && typeof cell === 'object' && 'formula' in cell && depth < 4) {
    const v = evaluate(cell.formula, sheet, depth + 1)
    return typeof v === 'number' ? v : null
  }
  return null
}

/** Works out the simple formulas the assistant writes (SUM, AVERAGE, MIN, MAX, COUNT over cells or ranges). Anything else returns null, and the formula is shown as written. */
export function evaluate(formula: string, sheet: SheetContent, depth = 0): number | null {
  const m = /^=?\s*(SUM|AVERAGE|MIN|MAX|COUNT)\(([^()]*)\)\s*$/i.exec(formula.trim())
  if (!m) return null
  const values: number[] = []
  for (const part of m[2]!.split(',')) {
    const [a, b] = part.trim().toUpperCase().split(':')
    const first = REF.exec(a ?? '')
    const last = b === undefined ? first : REF.exec(b)
    if (!first || !last) return null
    const c1 = colIndex(first[1]!), c2 = colIndex(last[1]!)
    const r1 = Number(first[2]) - 1, r2 = Number(last[2]) - 1
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
        const v = numberAt(sheet, c, r, depth)
        if (v !== null) values.push(v)
      }
    }
  }
  const fn = m[1]!.toUpperCase()
  if (fn === 'COUNT') return values.length
  if (!values.length) return fn === 'SUM' ? 0 : null
  if (fn === 'SUM') return values.reduce((a, b) => a + b, 0)
  if (fn === 'AVERAGE') return values.reduce((a, b) => a + b, 0) / values.length
  return fn === 'MIN' ? Math.min(...values) : Math.max(...values)
}

const pad = (n: number, f: Intl.NumberFormatOptions) => new Intl.NumberFormat('en-US', f).format(n)

/** How a cell reads in the preview, matching the number format the downloaded file uses. */
export function cellText(cell: SheetCell | undefined, format: string | undefined, sheet: SheetContent): { text: string, number: boolean, formula: boolean } {
  let value: SheetCell | undefined = cell
  let formula = false
  if (cell && typeof cell === 'object' && 'formula' in cell) {
    formula = true
    const n = evaluate(cell.formula, sheet)
    if (n === null) return { text: `=${cell.formula.replace(/^=/, '')}`, number: false, formula: true }
    value = n
  }
  if (value === null || value === undefined || value === '') return { text: '', number: false, formula }
  if (typeof value === 'boolean') return { text: value ? 'Yes' : 'No', number: false, formula }
  if (typeof value === 'number') {
    if (format === 'percent') return { text: `${pad(value * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`, number: true, formula }
    if (format === 'integer') return { text: pad(Math.round(value), { maximumFractionDigits: 0 }), number: true, formula }
    if (format === 'decimal') return { text: pad(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), number: true, formula }
    return { text: pad(value, { maximumFractionDigits: 6 }), number: true, formula }
  }
  if (format === 'date') {
    const d = new Date(`${value}T00:00:00Z`)
    if (!Number.isNaN(d.getTime())) return { text: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), number: false, formula }
  }
  return { text: String(value), number: false, formula }
}

/** The letter for a column: A, B, … AA. */
export const columnLetter = (i: number): string => (i >= 26 ? columnLetter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26))
