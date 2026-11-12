import { z } from 'zod'
import { blockSchema, slideSchema, sheetSpec } from '../documents/build/spec'
import type { DocumentSpec, PresentationSpec, WorkbookSpec } from '../documents/build/spec'
import { parseSpec } from './model'
import type { ArtifactKind, ArtifactSpec } from './model'

const n = (what: string) => z.number().int().min(1).describe(what)
const sheetNo = z.number().int().min(1).default(1).describe('Which sheet, counting from 1')

/**
 * One change to a file. Numbers count from 1, the way the outline shows them.
 * A change that does not fit the kind of file (a slide change on a spreadsheet) is refused with a plain message.
 */
export const changeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_title'), title: z.string().min(1).max(200) }),
  // Documents
  z.object({ op: z.literal('replace_block'), at: n('Block number to replace'), block: blockSchema }),
  z.object({ op: z.literal('insert_block'), at: n('The new block goes in this position; later blocks move down'), block: blockSchema }),
  z.object({ op: z.literal('delete_block'), at: n('Block number to remove') }),
  // Spreadsheets
  z.object({
    op: z.literal('set_cells'),
    sheet: sheetNo,
    cells: z.array(z.object({ row: n('Row number in the data, 1 is the first row under the headings'), col: n('Column number, 1 is the first column'), value: z.union([z.string().max(500), z.number(), z.boolean(), z.null(), z.object({ formula: z.string().max(200) })]) })).min(1).max(200)
  }),
  z.object({ op: z.literal('add_rows'), sheet: sheetNo, at: n('The new rows go in this position; later rows move down').optional().describe('Leave out to add at the end'), rows: z.array(sheetSpec.shape.rows.element).min(1).max(200) }),
  z.object({ op: z.literal('delete_rows'), sheet: sheetNo, from: n('First row to remove'), to: n('Last row to remove').optional() }),
  z.object({ op: z.literal('replace_sheet'), sheet: sheetNo, content: sheetSpec }),
  z.object({ op: z.literal('add_sheet'), content: sheetSpec }),
  z.object({ op: z.literal('delete_sheet'), sheet: sheetNo }),
  // Presentations
  z.object({ op: z.literal('replace_slide'), at: n('Slide number to replace'), slide: slideSchema }),
  z.object({ op: z.literal('insert_slide'), at: n('The new slide goes in this position; later slides move down'), slide: slideSchema }),
  z.object({ op: z.literal('delete_slide'), at: n('Slide number to remove') }),
  // Any file: change some words. Web pages: also the whole page
  z.object({
    op: z.literal('replace_text'),
    find: z.string().min(1).max(2000).describe('Exact words to change, copied as they are written in the file. They must be found once, so include enough around them'),
    replace: z.string().max(20_000).describe('What it becomes. Leave empty to remove it'),
    all: z.boolean().optional().describe('Set true to change every place it appears')
  }),
  z.object({ op: z.literal('replace_html'), html: z.string().min(1).max(200_000).describe('The whole page again. Only for a redesign; for small changes use replace_text') })
])
export type Change = z.infer<typeof changeSchema>

export class EditError extends Error {}

const DOCUMENT_OPS = new Set(['set_title', 'replace_text', 'replace_block', 'insert_block', 'delete_block'])
const WORKBOOK_OPS = new Set(['set_title', 'replace_text', 'set_cells', 'add_rows', 'delete_rows', 'replace_sheet', 'add_sheet', 'delete_sheet'])
const PRESENTATION_OPS = new Set(['set_title', 'replace_text', 'replace_slide', 'insert_slide', 'delete_slide'])
const PAGE_OPS = new Set(['set_title', 'replace_text', 'replace_html'])
// A project is changed with the project file tools; replace_text is the only change that also works on it.
const PROJECT_OPS = new Set(['set_title', 'replace_text'])
const OPS: Record<ArtifactKind, Set<string>> = { document: DOCUMENT_OPS, workbook: WORKBOOK_OPS, presentation: PRESENTATION_OPS, page: PAGE_OPS, project: PROJECT_OPS }
const WHAT: Record<ArtifactKind, string> = { document: 'a document', workbook: 'a spreadsheet', presentation: 'a presentation', page: 'a web page' }

function within(list: unknown[], at: number, what: string, allowEnd = false) {
  const max = list.length + (allowEnd ? 1 : 0)
  if (at < 1 || at > max) throw new EditError(`There is no ${what} ${at}. There ${list.length === 1 ? 'is' : 'are'} ${list.length}.`)
}

const MAX_CHANGES = 30

/** Words in these fields are structure, not content, so a find-and-replace never touches them. */
const STRUCTURE = new Set(['type', 'layout', 'formula', 'formats', 'level', 'path'])

/** Calls `fn` on every piece of text in a file, skipping the structure fields. */
function mapText(node: unknown, fn: (text: string) => string): unknown {
  if (typeof node === 'string') return fn(node)
  if (Array.isArray(node)) return node.map(item => mapText(item, fn))
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, STRUCTURE.has(key) ? value : mapText(value, fn)]))
  }
  return node
}

/** Changes words anywhere in a document, spreadsheet, presentation or page. */
function replaceWords(spec: any, change: { find: string, replace: string, all?: boolean }): any {
  // The title is changed with set_title, so it is left out here and a word in it is not counted as a second match.
  const inBody = (fn: (text: string) => string) => Object.fromEntries(Object.entries(spec).map(([key, value]) => [key, key === 'title' ? value : mapText(value, fn)]))
  let found = 0
  inBody(text => { found += text.split(change.find).length - 1; return text })
  if (found === 0) throw new EditError(`Those words are not in the file: "${change.find.slice(0, 60)}". Copy them exactly as they are written.`)
  if (found > 1 && !change.all) throw new EditError(`Those words appear ${found} times. Include more of the words around them, or set all to true to change every one.`)
  return inBody(text => text.split(change.find).join(change.replace))
}

/**
 * Applies changes to a copy of the spec and returns the checked result. The original is never touched, so a failure
 * half way leaves nothing changed. The result goes through the same rules as a new file.
 */
export function applyChanges(kind: ArtifactKind, current: ArtifactSpec, changes: Change[]): ArtifactSpec {
  if (!changes.length) throw new EditError('Nothing to change.')
  if (changes.length > MAX_CHANGES) throw new EditError(`Send at most ${MAX_CHANGES} changes at a time.`)
  let spec = structuredClone(current) as any
  for (const change of changes) {
    if (!OPS[kind].has(change.op)) throw new EditError(`"${change.op}" does not work on ${WHAT[kind]}.`)
    switch (change.op) {
      case 'set_title': spec.title = change.title; break
      case 'replace_html': spec.html = change.html; break
      case 'replace_text': spec = replaceWords(spec, change); break
      case 'replace_block': within(spec.blocks, change.at, 'block'); spec.blocks[change.at - 1] = change.block; break
      case 'insert_block': within(spec.blocks, change.at, 'position', true); spec.blocks.splice(change.at - 1, 0, change.block); break
      case 'delete_block': within(spec.blocks, change.at, 'block'); spec.blocks.splice(change.at - 1, 1); break
      case 'replace_slide': within(spec.slides, change.at, 'slide'); spec.slides[change.at - 1] = change.slide; break
      case 'insert_slide': within(spec.slides, change.at, 'position', true); spec.slides.splice(change.at - 1, 0, change.slide); break
      case 'delete_slide': within(spec.slides, change.at, 'slide'); spec.slides.splice(change.at - 1, 1); break
      case 'add_sheet': spec.sheets.push(change.content); break
      case 'delete_sheet': within(spec.sheets, change.sheet, 'sheet'); spec.sheets.splice(change.sheet - 1, 1); break
      case 'replace_sheet': within(spec.sheets, change.sheet, 'sheet'); spec.sheets[change.sheet - 1] = change.content; break
      case 'set_cells': {
        within(spec.sheets, change.sheet, 'sheet')
        const sheet = (spec as WorkbookSpec).sheets[change.sheet - 1]!
        for (const c of change.cells) {
          within(sheet.rows, c.row, 'row')
          if (c.col > sheet.header.length) throw new EditError(`There is no column ${c.col}. The sheet has ${sheet.header.length}.`)
          const row = sheet.rows[c.row - 1]!
          while (row.length < c.col) row.push(null)
          row[c.col - 1] = c.value
        }
        break
      }
      case 'add_rows': {
        within(spec.sheets, change.sheet, 'sheet')
        const sheet = (spec as WorkbookSpec).sheets[change.sheet - 1]!
        const at = change.at ?? sheet.rows.length + 1
        within(sheet.rows, at, 'position', true)
        sheet.rows.splice(at - 1, 0, ...change.rows)
        break
      }
      case 'delete_rows': {
        within(spec.sheets, change.sheet, 'sheet')
        const sheet = (spec as WorkbookSpec).sheets[change.sheet - 1]!
        const to = change.to ?? change.from
        if (to < change.from) throw new EditError('The last row comes before the first row.')
        within(sheet.rows, change.from, 'row'); within(sheet.rows, to, 'row')
        sheet.rows.splice(change.from - 1, to - change.from + 1)
        break
      }
    }
  }
  try {
    return parseSpec(kind, spec)
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0]
      throw new EditError(`The result is not valid${first ? ` (${first.path.join('.') || 'file'}: ${first.message})` : ''}. Nothing was changed.`)
    }
    throw err
  }
}

export type { DocumentSpec, PresentationSpec, WorkbookSpec }
