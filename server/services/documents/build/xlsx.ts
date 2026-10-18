import ExcelJS from 'exceljs'
import type { SheetCell, WorkbookSpec } from './spec'
import { BuildError, clean } from './spec'

// Formulas come from a model that may have read untrusted text, so only plain calculation is allowed.
const FUNCTIONS = new Set([
  'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'MEDIAN', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'ABS', 'IF', 'IFERROR',
  'AND', 'OR', 'NOT', 'SUMIF', 'COUNTIF', 'AVERAGEIF', 'SUMPRODUCT', 'LEN', 'UPPER', 'LOWER', 'TRIM', 'CONCAT', 'TEXT',
  'DATE', 'YEAR', 'MONTH', 'DAY', 'MOD', 'POWER', 'SQRT'
])

/** Returns the formula without a leading "=", or throws BuildError when it is not a plain calculation. */
export function checkFormula(raw: string): string {
  const formula = clean(raw).trim().replace(/^=/, '')
  if (!formula || formula.length > 200) throw new BuildError('A formula is empty or too long.')
  if (/[[\]{}\\]/.test(formula)) throw new BuildError(`The formula "${formula}" uses something that is not allowed (links to other files or arrays).`)
  const withoutStrings = formula.replace(/"[^"]*"/g, '""')
  if (!/^[A-Za-z0-9_ .,:;$()+\-*/^%<>=&!'"]+$/.test(withoutStrings)) throw new BuildError(`The formula "${formula}" contains characters that are not allowed.`)
  for (const match of withoutStrings.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
    if (!FUNCTIONS.has(match[1]!.toUpperCase())) throw new BuildError(`The function ${match[1]} is not allowed. Allowed: ${[...FUNCTIONS].join(', ')}.`)
  }
  return formula
}

const NUMBER_FORMATS: Record<string, string | undefined> = {
  general: undefined,
  integer: '#,##0',
  decimal: '#,##0.00',
  percent: '0.0%',
  date: 'yyyy-mm-dd'
}

const sheetName = (raw: string, taken: Set<string>) => {
  const base = clean(raw).replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet'
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`
  taken.add(name.toLowerCase())
  return name
}

export async function buildXlsx(spec: WorkbookSpec): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'OpenLobs'
  workbook.title = clean(spec.title)
  workbook.created = new Date()
  const taken = new Set<string>()

  for (const sheet of spec.sheets) {
    const ws = workbook.addWorksheet(sheetName(sheet.name, taken))
    const columns = sheet.header.length
    const header = ws.addRow(sheet.header.map(clean))
    header.font = { bold: true }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF1' } }
    header.alignment = { vertical: 'middle', wrapText: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    if (sheet.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns } }

    const widths = sheet.header.map(h => Math.min(50, Math.max(10, clean(h).length + 2)))
    for (const row of sheet.rows) {
      const cells = Array.from({ length: columns }, (_, c) => {
        const value: SheetCell | undefined = row[c]
        const format = sheet.formats?.[c]
        if (value === undefined || value === null) return null
        if (typeof value === 'object') return { formula: checkFormula(value.formula) }
        if (typeof value === 'string') {
          const text = clean(value)
          widths[c] = Math.min(50, Math.max(widths[c]!, text.length + 2))
          if (format === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00Z`)
          return text // stored as text: a leading "=" is never a formula
        }
        return value
      })
      ws.addRow(cells)
    }
    sheet.formats?.forEach((format, c) => {
      const numFmt = NUMBER_FORMATS[format]
      if (numFmt) ws.getColumn(c + 1).numFmt = numFmt
    })
    widths.forEach((w, c) => { ws.getColumn(c + 1).width = w })
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}
