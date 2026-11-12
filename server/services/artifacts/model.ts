import { buildDocx } from '../documents/build/docx'
import { buildPdf } from '../documents/build/pdf'
import { buildPptx } from '../documents/build/pptx'
import { buildXlsx } from '../documents/build/xlsx'
import { documentSpec, presentationSpec, workbookSpec } from '../documents/build/spec'
import type { DocumentSpec, PresentationSpec, WorkbookSpec } from '../documents/build/spec'
import { completePage, pageHeadings, pageProblem, PAGE_MAX_CHARS } from '../../../shared/pageHtml'
import { splitLines } from '../../../shared/lineDiff'
import { bundleProject, projectProblem, sortFiles } from '../../../shared/project'
import JSZip from 'jszip'
import { z } from 'zod'

/** A web page: one self-contained HTML file. See shared/pageHtml.ts for what it may contain. */
export const pageSpec = z.object({
  title: z.string().min(1).max(200).describe('Short name for the page, also used as the file name'),
  html: z.string().min(1).max(PAGE_MAX_CHARS).superRefine((html, ctx) => {
    const problem = pageProblem(html)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }).describe('The whole page as HTML with its CSS in a <style> tag. No outside files, fonts, scripts or pictures: draw with CSS and inline SVG.')
})
export type PageSpec = z.infer<typeof pageSpec>

/** A project: a folder of plain-text files built up over a chat. See shared/project.ts for the rules. */
export const projectSpec = z.object({
  title: z.string().min(1).max(200).describe('Short name for the project, also used as the file name of the download'),
  files: z.array(z.object({ path: z.string().min(1).max(200), content: z.string() })).superRefine((files, ctx) => {
    const problem = projectProblem(files)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  })
})
export type ProjectSpec = z.infer<typeof projectSpec>

export type ArtifactKind = 'document' | 'workbook' | 'presentation' | 'page' | 'project'
export type ArtifactFormat = 'docx' | 'pdf' | 'xlsx' | 'pptx' | 'html' | 'zip'
export type ArtifactSpec = DocumentSpec | WorkbookSpec | PresentationSpec | PageSpec | ProjectSpec

export const MIME_BY_FORMAT: Record<ArtifactFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'text/html; charset=utf-8',
  zip: 'application/zip'
}

export const ARTIFACT_LIMITS = {
  /** Versions kept per file. Going back further than this is not possible. */
  versions: 25,
  retentionDays: 30
} as const

export const KIND_FORMATS: Record<ArtifactKind, ArtifactFormat[]> = {
  document: ['docx', 'pdf'],
  workbook: ['xlsx'],
  presentation: ['pptx'],
  page: ['html'],
  project: ['zip']
}

export const KIND_LABEL: Record<ArtifactKind, string> = { document: 'Document', workbook: 'Spreadsheet', presentation: 'Presentation', page: 'Web page', project: 'Project' }

/** Checks a spec of the given kind with the same rules a new file goes through. Throws a zod error when it does not fit. */
export function parseSpec(kind: ArtifactKind, spec: unknown): ArtifactSpec {
  if (kind === 'document') return documentSpec.parse(spec)
  if (kind === 'workbook') return workbookSpec.parse(spec)
  if (kind === 'page') return pageSpec.parse(spec)
  if (kind === 'project') return projectSpec.parse(spec)
  return presentationSpec.parse(spec)
}

/** Builds the downloadable file for a spec. */
export async function buildArtifactFile(kind: ArtifactKind, format: ArtifactFormat, spec: ArtifactSpec): Promise<{ bytes: Uint8Array, mime: string }> {
  if (!KIND_FORMATS[kind].includes(format)) throw new Error('That format does not fit this kind of file.')
  let bytes: Uint8Array
  if (kind === 'document') bytes = format === 'pdf' ? await buildPdf(spec as DocumentSpec) : await buildDocx(spec as DocumentSpec)
  else if (kind === 'workbook') bytes = await buildXlsx(spec as WorkbookSpec)
  else if (kind === 'page') bytes = new TextEncoder().encode(completePage((spec as PageSpec).html, (spec as PageSpec).title))
  else if (kind === 'project') bytes = await zipProject(spec as ProjectSpec)
  else bytes = await buildPptx(spec as PresentationSpec)
  return { bytes, mime: MIME_BY_FORMAT[format] }
}

/** The project's files as a .zip, inside one folder named after the project so unzipping does not scatter files. */
async function zipProject(spec: ProjectSpec): Promise<Uint8Array> {
  const zip = new JSZip()
  const folder = spec.title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project'
  for (const file of sortFiles(spec.files)) zip.file(`${folder}/${file.path}`, file.content, { date: new Date('2000-01-01T00:00:00Z') })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

/** The project as one web page with its styles and scripts inside, or the plain reason it cannot be made. */
export function buildProjectPage(spec: ProjectSpec): { bytes: Uint8Array } | { problem: string } {
  const page = bundleProject(spec.files)
  return 'problem' in page ? page : { bytes: new TextEncoder().encode(page.html) }
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
  if (kind === 'page') {
    const { html } = spec as PageSpec
    return [`The whole page, ${Math.max(1, Math.round(html.length / 1000))}K characters`, ...pageHeadings(html).map(h => `Heading: ${h.trim()}`)]
  }
  if (kind === 'project') {
    const files = (spec as ProjectSpec).files
    return [`${files.length} file${files.length === 1 ? '' : 's'}`, ...sortFiles(files).slice(0, 80).map(f => `${f.path} (${splitLines(f.content).length} lines)`)]
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
  if (kind === 'page') return 'The page'
  if (kind === 'project') return 'The project'
  return selection.from === selection.to ? `Row ${selection.from}` : `Rows ${selection.from} to ${selection.to}`
}

/** What the person has picked in the pane. All numbers start at 1. A document uses block numbers, slides use the slide number, sheets use row numbers. */
export interface PartSelection {
  sheet?: number
  from: number
  to: number
  col?: number
}
