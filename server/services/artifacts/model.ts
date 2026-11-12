import { buildDocx } from '../documents/build/docx'
import { buildPdf } from '../documents/build/pdf'
import { buildPptx } from '../documents/build/pptx'
import { buildXlsx } from '../documents/build/xlsx'
import { documentSpec, presentationSpec, workbookSpec } from '../documents/build/spec'
import type { DocumentSpec, PresentationSpec, WorkbookSpec } from '../documents/build/spec'

export type ArtifactKind = 'document' | 'workbook' | 'presentation'
export type ArtifactFormat = 'docx' | 'pdf' | 'xlsx' | 'pptx'
export type ArtifactSpec = DocumentSpec | WorkbookSpec | PresentationSpec

export const MIME_BY_FORMAT: Record<ArtifactFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

export const ARTIFACT_LIMITS = {
  /** Versions kept per file. Going back further than this is not possible. */
  versions: 25,
  retentionDays: 30
} as const

export const KIND_FORMATS: Record<ArtifactKind, ArtifactFormat[]> = {
  document: ['docx', 'pdf'],
  workbook: ['xlsx'],
  presentation: ['pptx']
}

export const KIND_LABEL: Record<ArtifactKind, string> = { document: 'Document', workbook: 'Spreadsheet', presentation: 'Presentation' }

/** Checks a spec of the given kind with the same rules a new file goes through. Throws a zod error when it does not fit. */
export function parseSpec(kind: ArtifactKind, spec: unknown): ArtifactSpec {
  if (kind === 'document') return documentSpec.parse(spec)
  if (kind === 'workbook') return workbookSpec.parse(spec)
  return presentationSpec.parse(spec)
}

/** Builds the downloadable file for a spec. */
export async function buildArtifactFile(kind: ArtifactKind, format: ArtifactFormat, spec: ArtifactSpec): Promise<{ bytes: Uint8Array, mime: string }> {
  if (!KIND_FORMATS[kind].includes(format)) throw new Error('That format does not fit this kind of file.')
  let bytes: Uint8Array
  if (kind === 'document') bytes = format === 'pdf' ? await buildPdf(spec as DocumentSpec) : await buildDocx(spec as DocumentSpec)
  else if (kind === 'workbook') bytes = await buildXlsx(spec as WorkbookSpec)
  else bytes = await buildPptx(spec as PresentationSpec)
  return { bytes, mime: MIME_BY_FORMAT[format] }
}

const short = (text: string, n = 70) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text)

/**
 * The numbered parts of a file, one line each, so the assistant can say "part 3" and the person can see what that is.
 * Numbers start at 1, the way people count.
 */
export function outline(kind: ArtifactKind, spec: ArtifactSpec): string[] {
  if (kind === 'document') {
    return (spec as DocumentSpec).blocks.map((b, i) => {
      const n = i + 1
      if (b.type === 'heading') return `${n}. Heading (level ${b.level}): ${short(b.text)}`
      if (b.type === 'paragraph') return `${n}. Paragraph: ${short(b.text)}`
      if (b.type === 'table') return `${n}. Table: ${b.header.join(', ')} (${b.rows.length} rows)`
      return `${n}. ${b.type === 'bullets' ? 'Bullet list' : 'Numbered list'}: ${short(b.items[0] ?? '')} (${b.items.length} items)`
    })
  }
  if (kind === 'workbook') {
    return (spec as WorkbookSpec).sheets.map((s, i) => `Sheet ${i + 1}, "${s.name}": columns ${s.header.join(', ')} (${s.rows.length} rows)`)
  }
  return (spec as PresentationSpec).slides.map((s, i) => `${i + 1}. ${s.layout} slide: ${short(s.title)}`)
}

/** A name for the part the person is looking at, for the line they send ("Timeline: make it eight weeks"). */
export function partLabel(kind: ArtifactKind, spec: ArtifactSpec, selection: PartSelection): string {
  if (kind === 'document') {
    const blocks = (spec as DocumentSpec).blocks
    const first = blocks[selection.from - 1]
    if (!first) return 'This part'
    if (first.type === 'heading') return first.text
    if (first.type === 'paragraph') return `“${short(first.text, 40)}”`
    return first.type === 'table' ? 'The table' : 'The list'
  }
  if (kind === 'presentation') return `Slide ${selection.from}`
  return selection.from === selection.to ? `Row ${selection.from}` : `Rows ${selection.from} to ${selection.to}`
}

/** What the person has picked in the pane. All numbers start at 1. A document uses block numbers, slides use the slide number, sheets use row numbers. */
export interface PartSelection {
  sheet?: number
  from: number
  to: number
  col?: number
}
