import fs from 'node:fs'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { SHEET_LIMITS } from '../../shared/sheetOps'

/** Reading a spreadsheet: what is in it, and what a plain file library would lose if it saved a copy. */

export interface Features { charts: number, pivots: number, pictures: number, macros: boolean, externalLinks: number }

/** Counted from the parts inside the .xlsx file (it is a zip). CSV files have none of these. */
export async function scanFeatures(file: string): Promise<Features> {
  const none: Features = { charts: 0, pivots: 0, pictures: 0, macros: false, externalLinks: 0 }
  if (!file.toLowerCase().endsWith('.xlsx')) return none
  let zip: JSZip
  try { zip = await JSZip.loadAsync(fs.readFileSync(file)) } catch { throw new Error('That file is not a valid .xlsx workbook.') }
  const names = Object.keys(zip.files)
  return {
    charts: names.filter(n => /^xl\/charts\/chart[^/]*\.xml$/.test(n)).length,
    pivots: names.filter(n => /^xl\/pivotTables\/pivotTable[^/]*\.xml$/.test(n)).length,
    pictures: names.filter(n => /^xl\/media\//.test(n)).length,
    macros: names.some(n => /vbaProject\.bin$/.test(n)),
    externalLinks: names.filter(n => /^xl\/externalLinks\/externalLink[^/]*\.xml$/.test(n)).length
  }
}

export async function readWorkbook(file: string): Promise<ExcelJS.Workbook> {
  const size = fs.statSync(file).size
  if (size > SHEET_LIMITS.maxFileBytes) throw new Error(`That file is larger than ${Math.round(SHEET_LIMITS.maxFileBytes / 1048576)} MB, which is more than OpenLobs will open.`)
  const wb = new ExcelJS.Workbook()
  try {
    if (file.toLowerCase().endsWith('.csv')) await wb.csv.readFile(file)
    else await wb.xlsx.readFile(file)
  } catch { throw new Error('That file could not be read as a spreadsheet.') }
  return wb
}

/** What a cell shows, as short plain text. */
export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as any
    if ('error' in o) return String(o.error)
    if ('result' in o && o.result !== undefined && o.result !== null) return cellText(o.result)
    if ('formula' in o || 'sharedFormula' in o) return ''
    if ('richText' in o) return o.richText.map((t: any) => t.text).join('')
    if ('text' in o) return String(o.text)
    return ''
  }
  return String(v)
}

const isFormula = (v: ExcelJS.CellValue) => !!v && typeof v === 'object' && !(v instanceof Date) && ('formula' in (v as any) || 'sharedFormula' in (v as any))
const isError = (v: ExcelJS.CellValue) => {
  if (!v || typeof v !== 'object' || v instanceof Date) return false
  const o = v as any
  return 'error' in o || (typeof o.result === 'object' && o.result !== null && 'error' in o.result)
}
export const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/[\u0000-\u001f]/g, ' ')

export interface SheetSummary { name: string, rows: number, columns: number, headers: string[], sample: string[][], formulas: number, errors: number }

export function summarizeSheet(ws: ExcelJS.Worksheet): SheetSummary {
  let formulas = 0
  let errors = 0
  let lastRow = 0
  let lastCol = 0
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (c, col) => {
      if (isFormula(c.value)) formulas++
      if (isError(c.value)) errors++
      if (cellText(c.value) !== '' || isFormula(c.value)) { lastRow = Math.max(lastRow, r); lastCol = Math.max(lastCol, col) }
    })
  })
  const cols = Math.min(lastCol, SHEET_LIMITS.maxInspectCols)
  const line = (r: number) => Array.from({ length: cols }, (_, i) => clip(cellText(ws.getCell(r, i + 1).value)))
  const headers = lastRow ? line(1) : []
  const sample: string[][] = []
  for (let r = 2; r <= Math.min(lastRow, 1 + SHEET_LIMITS.maxInspectRows); r++) sample.push(line(r))
  return { name: ws.name, rows: lastRow, columns: lastCol, headers, sample, formulas, errors }
}

/** Opens a file and describes it, without changing it. */
export async function inspectWorkbook(file: string, shownName: string) {
  const [wb, features] = await Promise.all([readWorkbook(file), scanFeatures(file)])
  const sheets = wb.worksheets.slice(0, SHEET_LIMITS.maxInspectSheets).map(summarizeSheet)
  const notes: string[] = []
  if (wb.worksheets.length > SHEET_LIMITS.maxInspectSheets) notes.push(`Only the first ${SHEET_LIMITS.maxInspectSheets} of ${wb.worksheets.length} sheets are shown.`)
  if (features.charts || features.pivots || features.pictures || features.macros) notes.push('This file has charts, pivot tables, pictures or macros. A changed copy made without a spreadsheet program would lose them.')
  if (features.externalLinks) notes.push('This file links to other workbooks; those links are not followed.')
  if (sheets.some(s => s.formulas && s.rows && !s.sample.length)) notes.push('Formula results are shown only if the file was last saved by a spreadsheet program.')
  return {
    file: shownName,
    sizeKb: Math.ceil(fs.statSync(file).size / 1024),
    sheets,
    features,
    notes
  }
}
