import { z } from 'zod'

/**
 * What OpenLobs may ask a computer to do to a spreadsheet. Both sides use these same definitions: the server
 * checks a request before it is queued, and the Bridge checks it again before touching a file. There is no way
 * to ask for "run this" here: only a short list of named operations with strictly checked fields.
 */

export const SHEET_LIMITS = {
  maxOps: 40,
  maxCells: 2000,
  maxFormula: 500,
  maxText: 1000,
  maxFillRows: 5000,
  maxSummaryGroups: 200,
  maxFileBytes: 15 * 1024 * 1024,
  maxInspectSheets: 12,
  maxInspectCols: 20,
  maxInspectRows: 6,
  maxListed: 40,
  /** What a result may weigh once it is sent back to OpenLobs. */
  maxResultChars: 14_000
}

// ---- Names and addresses ----
const sheetName = z.string().min(1).max(31).refine(s => !/[[\]:*?/\\]/.test(s) && !s.startsWith('\'') && !s.endsWith('\''), 'A sheet name cannot contain [ ] : * ? / \\ or start or end with an apostrophe.')
const cell = z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/, 'Use a cell address like B7.')
const range = z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}:[A-Z]{1,3}[1-9][0-9]{0,6}$/, 'Use a range like A1:D20.')
const column = z.string().regex(/^[A-Z]{1,3}$/, 'Use a column letter like C.')
const row = z.number().int().min(1).max(1_048_576)

/**
 * A file inside the folder the person chose, written relative to it. Absolute paths, drive letters, network
 * shares and ".." are refused here and again on the computer, where the real folder is known.
 */
export const workspaceFile = z.string().trim().min(1).max(200).refine((p) => {
  if (/^([a-zA-Z]:|[\\/])/.test(p) || p.includes('..') || /[<>:"|?*\u0000-\u001f]/.test(p)) return false
  return !p.split(/[\\/]/).some(part => part === '' || part === '.' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(part) || part.endsWith('.') || part.endsWith(' '))
}, 'Use a file name or a path inside the chosen folder, such as "Budget.xlsx" or "2026/Budget.xlsx".')
export const SHEET_EXTENSIONS = ['.xlsx', '.csv'] as const
export const hasSheetExtension = (p: string) => SHEET_EXTENSIONS.some(e => p.toLowerCase().endsWith(e))
const sourceFile = workspaceFile.refine(hasSheetExtension, 'Only .xlsx and .csv files can be read.')
const outputFile = workspaceFile.refine(p => p.toLowerCase().endsWith('.xlsx'), 'The new file must end in .xlsx.')

// ---- Formulas ----
/**
 * A formula runs inside the spreadsheet program, and some functions reach outside it: the web, other programs,
 * other files. None of those may be written, whatever the reason.
 */
const FORBIDDEN_FORMULA = /\b(WEBSERVICE|FILTERXML|ENCODEURL|CALL|REGISTER(\.ID)?|EXEC|SHELL|HYPERLINK|RTD|DDE|IMPORTDATA|IMPORTXML|IMPORTHTML|IMPORTRANGE|IMAGE|INFO|CELL|GETPIVOTDATA|EVALUATE|FORMULA)\s*\(|[\\|]|\[|https?:|file:|ftp:|\bcmd\b|\bpowershell\b/i
export function checkFormula(formula: string): string | null {
  const f = formula.replace(/^=/, '')
  if (!f.trim()) return 'The formula is empty.'
  if (f.length > SHEET_LIMITS.maxFormula) return `A formula can be at most ${SHEET_LIMITS.maxFormula} characters.`
  if (/[\u0000-\u001f]/.test(f)) return 'A formula cannot contain control characters.'
  if (FORBIDDEN_FORMULA.test(f)) return 'That formula uses a function or reference that reaches outside the spreadsheet, which is not allowed.'
  return null
}
const formula = z.string().max(SHEET_LIMITS.maxFormula + 1).superRefine((f, ctx) => { const bad = checkFormula(f); if (bad) ctx.addIssue({ code: 'custom', message: bad }) })

const scalar = z.union([z.string().max(SHEET_LIMITS.maxText), z.number().finite(), z.boolean(), z.null()])

// ---- Operations ----
export const sheetOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('set_cells'),
    sheet: sheetName,
    cells: z.array(z.union([
      z.object({ ref: cell, value: scalar }).strict(),
      z.object({ ref: cell, formula }).strict()
    ])).min(1).max(SHEET_LIMITS.maxCells)
  }).strict(),
  z.object({
    op: z.literal('fill_formula'),
    sheet: sheetName,
    column,
    fromRow: row,
    toRow: row,
    /** Written once per row; {row} becomes the row number, for example =B{row}*C{row}. */
    formula,
    header: z.string().max(100).optional(),
    headerRow: row.optional()
  }).strict().refine(o => o.toRow >= o.fromRow && o.toRow - o.fromRow < SHEET_LIMITS.maxFillRows, 'toRow must be after fromRow, and at most 5000 rows can be filled at once.'),
  z.object({ op: z.literal('add_sheet'), name: sheetName }).strict(),
  z.object({ op: z.literal('rename_sheet'), from: sheetName, to: sheetName }).strict(),
  z.object({ op: z.literal('delete_sheet'), name: sheetName }).strict(),
  z.object({
    op: z.literal('clean_range'),
    sheet: sheetName,
    range,
    /** Remove spaces at the ends and doubled spaces inside text. */
    trim: z.boolean().default(true),
    /** Turn text such as "1,234.50" or "$20" into real numbers. */
    toNumber: z.boolean().default(false)
  }).strict(),
  z.object({
    op: z.literal('sort_rows'),
    sheet: sheetName,
    range,
    by: column,
    order: z.enum(['asc', 'desc']).default('asc'),
    hasHeader: z.boolean().default(true)
  }).strict(),
  z.object({
    op: z.literal('format_range'),
    sheet: sheetName,
    range,
    numberFormat: z.string().max(40).regex(/^[0#?,.\-+%$€£¢₵\sA-Za-z/:;"@\\_()*]*$/, 'That number format has characters that are not allowed.').optional(),
    bold: z.boolean().optional(),
    fill: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a colour like #FFE699.').optional(),
    autoWidth: z.boolean().optional()
  }).strict(),
  z.object({
    op: z.literal('summarize'),
    /** Totals (or counts, averages...) of one column for each different value in another. Written as real formulas. */
    source: sheetName,
    groupBy: column,
    value: column,
    fn: z.enum(['sum', 'average', 'count', 'min', 'max']).default('sum'),
    headerRow: row.default(1),
    target: sheetName
  }).strict(),
  z.object({
    op: z.literal('add_chart'),
    /** Needs a spreadsheet program (Excel or LibreOffice) on the computer; a file library cannot draw charts. */
    sheet: sheetName,
    type: z.enum(['column', 'bar', 'line', 'pie']),
    categories: range,
    values: range,
    title: z.string().max(100).default(''),
    anchor: cell.default('H2')
  }).strict()
])
export type SheetOp = z.infer<typeof sheetOpSchema>
export const sheetOpsSchema = z.array(sheetOpSchema).min(1).max(SHEET_LIMITS.maxOps)

// ---- Requests ----
export const workbookListInput = z.object({ folder: workspaceFile.optional() }).strict()
export const workbookInspectInput = z.object({ file: sourceFile }).strict()
export const workbookApplyInput = z.object({
  file: sourceFile,
  /** Name of the new workbook. Defaults to "<name> (OpenLobs).xlsx". An existing file is never replaced. */
  output: outputFile.optional(),
  ops: sheetOpsSchema,
  /** Go ahead although the original has charts, pivot tables, pictures or macros the new copy will lose. */
  acceptLosses: z.boolean().default(false),
  /** Also save a PDF next to it (needs Excel or LibreOffice). */
  pdf: z.boolean().default(false)
}).strict()
export type WorkbookApplyInput = z.infer<typeof workbookApplyInput>

// ---- Results ----
const note = z.string().max(300)
export const workbookListResult = z.object({
  folder: z.string().max(200),
  files: z.array(z.object({ name: z.string().max(200), sizeKb: z.number().int().min(0), modified: z.string().max(40) }).strict()).max(SHEET_LIMITS.maxListed),
  truncated: z.boolean().default(false)
}).strict()

const cellText = z.string().max(60)
export const workbookInspectResult = z.object({
  file: z.string().max(200),
  sizeKb: z.number().int().min(0),
  sheets: z.array(z.object({
    name: sheetName,
    rows: z.number().int().min(0),
    columns: z.number().int().min(0),
    headers: z.array(cellText).max(SHEET_LIMITS.maxInspectCols),
    sample: z.array(z.array(cellText).max(SHEET_LIMITS.maxInspectCols)).max(SHEET_LIMITS.maxInspectRows),
    formulas: z.number().int().min(0),
    errors: z.number().int().min(0)
  }).strict()).max(SHEET_LIMITS.maxInspectSheets),
  features: z.object({ charts: z.number().int(), pivots: z.number().int(), pictures: z.number().int(), macros: z.boolean(), externalLinks: z.number().int() }).strict(),
  notes: z.array(note).max(10).default([])
}).strict()

export const workbookApplyResult = z.object({
  output: z.string().max(200),
  engine: z.enum(['excel', 'libreoffice']).nullable(),
  sheets: z.array(sheetName).max(30),
  steps: z.array(note).max(SHEET_LIMITS.maxOps + 5),
  checks: z.array(z.object({ name: z.string().max(120), ok: z.boolean(), detail: z.string().max(300) }).strict()).max(40),
  formulas: z.number().int().min(0),
  errors: z.array(note).max(20),
  charts: z.number().int().min(0),
  pdf: z.string().max(200).nullable(),
  sizeKb: z.number().int().min(0),
  warnings: z.array(note).max(10).default([])
}).strict()
export type WorkbookApplyResult = z.infer<typeof workbookApplyResult>
