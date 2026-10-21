import { DocumentError } from './errors'
import { assertSafeZip } from './zipGuard'

export type DocumentKind = 'pdf' | 'docx' | 'csv' | 'markdown' | 'json' | 'text'

export interface ExtractedDocument {
  kind: DocumentKind
  text: string
  /** PDF only. */
  pages?: number
  /** Short facts about the file, e.g. "120 rows x 5 columns". */
  summary: string
}

const KIND_LABEL: Record<DocumentKind, string> = {
  pdf: 'PDF',
  docx: 'Word document',
  csv: 'CSV table',
  markdown: 'Markdown file',
  json: 'JSON file',
  text: 'text file'
}
export const kindLabel = (kind: DocumentKind) => KIND_LABEL[kind]

const startsWith = (bytes: Uint8Array, ...sig: number[]) => sig.every((b, i) => bytes[i] === b)

/**
 * Works out what a file really is. The browser's label is only a hint: the first bytes decide for
 * PDF and Word, and the name decides between the text formats.
 */
export function sniffKind(bytes: Uint8Array, filename: string, declared: string): DocumentKind | null {
  if (startsWith(bytes, 0x25, 0x50, 0x44, 0x46)) return 'pdf' // %PDF
  if (startsWith(bytes, 0x50, 0x4B, 0x03, 0x04)) {
    // A zip. Only Word documents are read; other Office files are zips too.
    return /\.docx$/i.test(filename) || /wordprocessingml/.test(declared) ? 'docx' : null
  }
  // Binary formats we do not read.
  if (startsWith(bytes, 0xD0, 0xCF, 0x11, 0xE0) || startsWith(bytes, 0x89, 0x50, 0x4E, 0x47) || startsWith(bytes, 0xFF, 0xD8, 0xFF)) return null
  if (bytes.subarray(0, 4096).includes(0)) return null // NUL byte: not text

  if (/\.csv$/i.test(filename) || declared === 'text/csv') return 'csv'
  if (/\.(md|markdown)$/i.test(filename) || declared === 'text/markdown') return 'markdown'
  if (/\.json$/i.test(filename) || declared === 'application/json') return 'json'
  if (/\.txt$/i.test(filename) || declared.startsWith('text/')) return 'text'
  return null
}

const decodeText = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')

async function readPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  let pdf
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes))
  } catch (err: any) {
    if (/password/i.test(err?.message ?? '') || err?.name === 'PasswordException') {
      throw new DocumentError('This PDF is password protected, so it cannot be read.')
    }
    throw new DocumentError('This PDF could not be opened. It may be damaged.')
  }
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = text.map((t, i) => `[Page ${i + 1}]\n${t.trim()}`)
  const joined = pages.join('\n\n')
  const hasText = text.some(t => t.trim().length > 0)
  if (!hasText) {
    throw new DocumentError(`This PDF has ${totalPages} page(s) but no readable text. It is probably a scan or images, and reading scans is not supported.`)
  }
  return { kind: 'pdf', text: joined, pages: totalPages, summary: `${totalPages} page${totalPages === 1 ? '' : 's'}` }
}

async function readDocx(bytes: Uint8Array): Promise<ExtractedDocument> {
  assertSafeZip(bytes)
  // convertToMarkdown exists at runtime but is missing from mammoth's type definitions.
  const imported: any = await import('mammoth')
  const mammoth = imported.default ?? imported
  let value: string
  try {
    // Pictures are not read, and are replaced by a marker so the text never carries inline image data.
    const result = await mammoth.convertToMarkdown(
      { buffer: Buffer.from(bytes) },
      { convertImage: mammoth.images.imgElement(async () => ({ src: 'image' })) }
    )
    value = result.value
  } catch {
    throw new DocumentError('This Word document could not be opened. It may be damaged or password protected.')
  }
  const text = value.replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) throw new DocumentError('This Word document has no readable text.')
  return { kind: 'docx', text, summary: `${text.split(/\s+/).length} words` }
}

async function readCsv(bytes: Uint8Array): Promise<ExtractedDocument> {
  const text = decodeText(bytes)
  const Papa = (await import('papaparse')).default
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' })
  const rows = parsed.data
  if (!rows.length) throw new DocumentError('This CSV file is empty.')
  const columns = Math.max(...rows.map(r => r.length))
  const header = rows[0]!.map(c => String(c).trim()).filter(Boolean).slice(0, 20).join(', ')
  return {
    kind: 'csv',
    text: text.trim(),
    summary: `${rows.length} rows (including the header row) x ${columns} columns. First row: ${header}`
  }
}

/** Reads a file the user attached and returns its text. Throws DocumentError with a user-safe message. */
export async function extractDocument(bytes: Uint8Array, filename: string, declaredType: string): Promise<ExtractedDocument> {
  const kind = sniffKind(bytes, filename, declaredType.toLowerCase())
  if (!kind) {
    throw new DocumentError('This type of file cannot be read. Supported: PDF, Word (.docx), CSV, Markdown, JSON and plain text.')
  }
  if (kind === 'pdf') return await readPdf(bytes)
  if (kind === 'docx') return await readDocx(bytes)
  if (kind === 'csv') return await readCsv(bytes)

  const text = decodeText(bytes).trim()
  if (!text) throw new DocumentError('The file is empty.')
  if (kind === 'json') {
    try {
      return { kind, text: JSON.stringify(JSON.parse(text), null, 2), summary: 'valid JSON' }
    } catch {
      return { kind, text, summary: 'not valid JSON, shown as plain text' }
    }
  }
  return { kind, text, summary: `${text.split(/\s+/).length} words` }
}
