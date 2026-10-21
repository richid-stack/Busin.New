import { z } from 'zod'

// Everything here is a limit on what the model may ask for, so one request cannot produce a huge file.
export const LIMITS = {
  title: 200,
  blocks: 300,
  paragraph: 6000,
  listItems: 100,
  itemChars: 600,
  tableColumns: 10,
  tableRows: 300,
  cellChars: 500,
  sheets: 8,
  sheetRows: 2000,
  sheetColumns: 30,
  slides: 30,
  slideBullets: 8,
  slideTableRows: 12,
  fileBytes: 700_000
} as const

/** Removes control characters (keeps line breaks and tabs) and trims. Used on every string that goes into a file. */
export function clean(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n')
}

const cell = z.string().max(LIMITS.cellChars)
const table = {
  header: z.array(cell).min(1).max(LIMITS.tableColumns).describe('Column headings'),
  rows: z.array(z.array(cell).max(LIMITS.tableColumns)).max(LIMITS.tableRows).describe('Rows of cell text, in the same order as the headings')
}

export const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string().min(1).max(LIMITS.title), level: z.number().int().min(1).max(3).default(1) }),
  z.object({ type: z.literal('paragraph'), text: z.string().min(1).max(LIMITS.paragraph) }),
  z.object({ type: z.literal('bullets'), items: z.array(z.string().min(1).max(LIMITS.itemChars)).min(1).max(LIMITS.listItems) }),
  z.object({ type: z.literal('numbered'), items: z.array(z.string().min(1).max(LIMITS.itemChars)).min(1).max(LIMITS.listItems) }),
  z.object({ type: z.literal('table'), ...table })
])
export type Block = z.infer<typeof blockSchema>

export const documentSpec = z.object({
  title: z.string().min(1).max(LIMITS.title).describe('Document title, shown at the top'),
  blocks: z.array(blockSchema).min(1).max(LIMITS.blocks).describe('The content, in reading order')
})
export type DocumentSpec = z.infer<typeof documentSpec>

const sheetCell = z.union([
  z.string().max(LIMITS.cellChars),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ formula: z.string().max(200) }).describe('A formula such as {"formula":"SUM(B2:B10)"}')
])
export const sheetSpec = z.object({
  name: z.string().min(1).max(60),
  header: z.array(z.string().max(120)).min(1).max(LIMITS.sheetColumns).describe('Column headings (first row)'),
  rows: z.array(z.array(sheetCell).max(LIMITS.sheetColumns)).max(LIMITS.sheetRows),
  formats: z.array(z.enum(['general', 'integer', 'decimal', 'percent', 'date'])).max(LIMITS.sheetColumns).optional()
    .describe('Optional number format per column. "date" columns take ISO dates like 2026-03-31.')
})
export const workbookSpec = z.object({
  title: z.string().min(1).max(LIMITS.title),
  sheets: z.array(sheetSpec).min(1).max(LIMITS.sheets)
})
export type WorkbookSpec = z.infer<typeof workbookSpec>
export type SheetCell = z.infer<typeof sheetCell>

const notes = z.string().max(2000).optional().describe('Speaker notes')
export const slideSchema = z.discriminatedUnion('layout', [
  z.object({ layout: z.literal('title'), title: z.string().min(1).max(LIMITS.title), subtitle: z.string().max(300).optional(), notes }),
  z.object({
    layout: z.literal('content'),
    title: z.string().min(1).max(LIMITS.title),
    bullets: z.array(z.string().min(1).max(250)).max(LIMITS.slideBullets).optional(),
    text: z.string().max(1200).optional().describe('A short paragraph instead of bullets'),
    notes
  }),
  z.object({
    layout: z.literal('table'),
    title: z.string().min(1).max(LIMITS.title),
    header: z.array(cell).min(1).max(6),
    rows: z.array(z.array(cell).max(6)).max(LIMITS.slideTableRows),
    notes
  })
])
export const presentationSpec = z.object({
  title: z.string().min(1).max(LIMITS.title),
  slides: z.array(slideSchema).min(1).max(LIMITS.slides)
})
export type PresentationSpec = z.infer<typeof presentationSpec>

export class BuildError extends Error {}
