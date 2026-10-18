import { tool } from 'ai'
import { z } from 'zod'
import { buildDocx } from '../../services/documents/build/docx'
import { buildPdf } from '../../services/documents/build/pdf'
import { buildPptx } from '../../services/documents/build/pptx'
import { buildXlsx } from '../../services/documents/build/xlsx'
import { BuildError, documentSpec, presentationSpec, workbookSpec } from '../../services/documents/build/spec'
import { FILE_RETENTION_DAYS, MAX_FILE_BYTES, safeFileName } from '../../services/files/store'
import { fileStore } from '../../services/files'
import { checkRateLimit } from '../rateLimit'
import { withToolLimits } from './limits'

type Store = Pick<ReturnType<typeof fileStore>, 'save'>

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
} as const
type Format = keyof typeof MIME

const DAILY_FILES = 30

/** Builds a file, saves it for the user, and returns what the chat card needs. */
async function issue(userId: string, store: Store, format: Format, title: string, build: () => Promise<Uint8Array>) {
  const gate = checkRateLimit('file-day', userId, DAILY_FILES, 86_400_000)
  if (!gate.ok) return { status: 'failed' as const, error: `The daily limit of ${DAILY_FILES} created files has been reached. Tell the user to try again tomorrow.` }

  let bytes: Uint8Array
  try {
    bytes = await build()
  } catch (err: any) {
    if (err instanceof BuildError) return { status: 'failed' as const, error: `${err.message} Fix it and try again.` }
    throw err
  }
  if (bytes.length > MAX_FILE_BYTES) {
    return { status: 'failed' as const, error: `The file came out at ${Math.round(bytes.length / 1024)} KB, over the ${Math.round(MAX_FILE_BYTES / 1000)} KB limit. Make the content shorter or split it into several files.` }
  }
  const name = safeFileName(title, format)
  const { id } = await store.save({ userId, name, mime: MIME[format], bytes })
  return {
    status: 'ok' as const,
    fileId: id,
    name,
    format,
    sizeKb: Math.max(1, Math.round(bytes.length / 1024)),
    expiresInDays: FILE_RETENTION_DAYS,
    message: 'The file is ready and the user can download it from the card in the chat. Say what it contains in a sentence or two. Do not paste a link.'
  }
}

const limits = (name: string, userId: string) => ({ name, userId, perMinute: 6, timeoutMs: 25_000, maxResultChars: 3_000 })

export function createDocumentTool(userId: string, store: Store = fileStore()) {
  return tool({
    description: 'Create a Word (.docx) or PDF document from structured content and give it to the user to download. Use it when the user asks for a report, letter, proposal, one-pager, contract draft, CV or any document file. Write the full content first: headings, paragraphs, bullet lists, numbered lists and tables. Plain text only: no images or links.',
    inputSchema: documentSpec.extend({ format: z.enum(['docx', 'pdf']).default('docx').describe('docx for an editable Word file, pdf for a final read-only copy') }),
    execute: withToolLimits(limits('create_document', userId), ({ format, ...spec }) => issue(userId, store, format, spec.title, () => format === 'pdf' ? buildPdf(spec) : buildDocx(spec)))
  })
}

export function createSpreadsheetTool(userId: string, store: Store = fileStore()) {
  return tool({
    description: 'Create an Excel (.xlsx) spreadsheet and give it to the user to download. Use it for budgets, trackers, tables of data, comparisons and simple models. Each sheet has a header row and rows of values. Numbers must be real numbers, not text. For totals and calculations use formulas such as {"formula":"SUM(B2:B10)"}; only plain calculation functions are allowed.',
    inputSchema: workbookSpec,
    execute: withToolLimits(limits('create_spreadsheet', userId), spec => issue(userId, store, 'xlsx', spec.title, () => buildXlsx(spec)))
  })
}

export function createPresentationTool(userId: string, store: Store = fileStore()) {
  return tool({
    description: 'Create a PowerPoint (.pptx) presentation and give it to the user to download. Start with a title slide. Keep slides short: a title and up to 8 brief bullets, or one small table. Put detail in speaker notes.',
    inputSchema: presentationSpec,
    execute: withToolLimits(limits('create_presentation', userId), spec => issue(userId, store, 'pptx', spec.title, () => buildPptx(spec)))
  })
}
