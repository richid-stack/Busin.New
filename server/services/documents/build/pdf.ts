import { PDFDocument, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { extBold, extRegular, latinBold, latinRegular } from '../fonts.generated'
import type { Block, DocumentSpec } from './spec'
import { clean } from './spec'

const PAGE = { width: 595.28, height: 841.89, margin: 56 }
const INK = rgb(0.12, 0.14, 0.18)
const MUTED = rgb(0.45, 0.48, 0.53)
const RULE = rgb(0.8, 0.83, 0.87)
const HEAD_FILL = rgb(0.91, 0.93, 0.95)

type Weight = 'regular' | 'bold'

interface Face {
  font: PDFFont
  has: (codePoint: number) => boolean
}

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))

/**
 * Noto Sans in two parts per weight: Latin for everyday text, and Latin Extended for letters such as
 * the cedi sign and Twi or Ewe letters. A character in neither is written as "?", never dropped silently.
 */
async function loadFaces(pdf: PDFDocument) {
  pdf.registerFontkit(fontkit as any)
  const load = async (b64: string): Promise<Face> => {
    const data = bytes(b64)
    const probe = (fontkit as any).create(data)
    return { font: await pdf.embedFont(data, { subset: true }), has: (cp: number) => probe.hasGlyphForCodePoint(cp) }
  }
  const [lr, lb, er, eb] = await Promise.all([load(latinRegular), load(latinBold), load(extRegular), load(extBold)])
  return { regular: [lr, er], bold: [lb, eb] } as Record<Weight, Face[]>
}

export async function buildPdf(spec: DocumentSpec): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(clean(spec.title))
  pdf.setCreator('OpenLobs')
  pdf.setProducer('OpenLobs')
  const faces = await loadFaces(pdf)

  const faceFor = (weight: Weight, ch: string): Face | null => {
    const cp = ch.codePointAt(0)!
    return faces[weight].find(f => f.has(cp)) ?? null
  }
  const widthCache = new Map<string, number>()
  const charWidth = (weight: Weight, ch: string, size: number) => {
    const key = `${weight}|${ch}|${size}`
    let w = widthCache.get(key)
    if (w === undefined) {
      const face = faceFor(weight, ch)
      w = face ? face.font.widthOfTextAtSize(ch, size) : 0
      widthCache.set(key, w)
    }
    return w
  }
  /** Replaces what no font has with "?" and tabs with spaces. */
  const printable = (text: string) => Array.from(clean(text).replace(/\t/g, '    ')).map(ch => (ch === '\n' || faceFor('regular', ch) ? ch : '?')).join('')
  const widthOf = (weight: Weight, text: string, size: number) => Array.from(text).reduce((sum, ch) => sum + charWidth(weight, ch, size), 0)

  /** Breaks text into lines that fit `width`; long words are split where they must be. */
  const wrap = (text: string, weight: Weight, size: number, width: number): string[] => {
    const lines: string[] = []
    for (const paragraph of printable(text).split('\n')) {
      let line = ''
      for (const word of paragraph.split(/(?<=\s)/)) {
        if (widthOf(weight, (line + word).trimEnd(), size) <= width) { line += word; continue }
        if (line.trim()) { lines.push(line.trimEnd()); line = '' }
        if (widthOf(weight, word.trimEnd(), size) <= width) { line = word; continue }
        for (const ch of Array.from(word)) {
          if (widthOf(weight, line + ch, size) > width && line) { lines.push(line); line = '' }
          line += ch
        }
      }
      lines.push(line.trimEnd())
    }
    return lines
  }

  /** Draws one line, switching font where a character needs the other one. */
  const drawLine = (page: PDFPage, text: string, x: number, y: number, weight: Weight, size: number, color = INK) => {
    let run = ''
    let runFace: Face | null = null
    let cursor = x
    const flush = () => {
      if (run && runFace) {
        page.drawText(run, { x: cursor, y, size, font: runFace.font, color })
        cursor += runFace.font.widthOfTextAtSize(run, size)
      }
      run = ''
    }
    for (const ch of Array.from(text)) {
      const face = faceFor(weight, ch)
      if (face !== runFace) { flush(); runFace = face }
      run += ch
    }
    flush()
  }

  let page = pdf.addPage([PAGE.width, PAGE.height])
  let y = PAGE.height - PAGE.margin
  const bottom = PAGE.margin + 18
  const contentWidth = PAGE.width - PAGE.margin * 2
  const newPage = () => { page = pdf.addPage([PAGE.width, PAGE.height]); y = PAGE.height - PAGE.margin }
  const ensure = (height: number) => { if (y - height < bottom) newPage() }

  const text = (value: string, opts: { size: number, weight?: Weight, indent?: number, after?: number, color?: ReturnType<typeof rgb>, keepWithNext?: boolean, first?: string }) => {
    const weight = opts.weight ?? 'regular'
    const indent = opts.indent ?? 0
    const lineHeight = opts.size * 1.45
    const lines = wrap(value, weight, opts.size, contentWidth - indent)
    // A heading never ends a page on its own.
    ensure(lineHeight * Math.min(lines.length, 2) + (opts.keepWithNext ? opts.size * 2.5 : 0))
    lines.forEach((line, i) => {
      ensure(lineHeight)
      y -= lineHeight
      if (i === 0 && opts.first) drawLine(page, opts.first, PAGE.margin + indent - widthOf(weight, opts.first + ' ', opts.size), y, weight, opts.size, opts.color)
      drawLine(page, line, PAGE.margin + indent, y, weight, opts.size, opts.color)
    })
    y -= opts.after ?? 6
  }

  const drawTable = (block: Extract<Block, { type: 'table' }>) => {
    const columns = block.header.length
    const size = 9.5
    const pad = 5
    const lineHeight = size * 1.4
    // Wider columns for longer content, never below 8% of the width.
    const longest = Array.from({ length: columns }, (_, c) => Math.max(block.header[c]!.length, ...block.rows.map(r => (r[c] ?? '').length), 4))
    const weights = longest.map(n => Math.sqrt(Math.min(n, 60)))
    const total = weights.reduce((a, b) => a + b, 0)
    const widths = weights.map(w => Math.max(contentWidth * 0.08, (w / total) * contentWidth))
    const scale = contentWidth / widths.reduce((a, b) => a + b, 0)
    const colW = widths.map(w => w * scale)

    const row = (cells: string[], header: boolean) => {
      const weight: Weight = header ? 'bold' : 'regular'
      const wrapped = colW.map((w, c) => wrap(cells[c] ?? '', weight, size, w - pad * 2))
      const height = Math.max(...wrapped.map(l => l.length)) * lineHeight + pad * 2
      ensure(Math.min(height, PAGE.height - PAGE.margin * 2))
      const top = y
      if (header) page.drawRectangle({ x: PAGE.margin, y: top - height, width: contentWidth, height, color: HEAD_FILL })
      let x = PAGE.margin
      wrapped.forEach((lines, c) => {
        lines.forEach((line, i) => drawLine(page, line, x + pad, top - pad - lineHeight * (i + 1) + 3, weight, size))
        x += colW[c]!
      })
      page.drawLine({ start: { x: PAGE.margin, y: top - height }, end: { x: PAGE.margin + contentWidth, y: top - height }, thickness: 0.5, color: RULE })
      y = top - height
    }

    ensure(lineHeight * 3 + pad * 2)
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.margin + contentWidth, y }, thickness: 0.5, color: RULE })
    row(block.header, true)
    for (const r of block.rows) row(r, false)
    y -= 12
  }

  text(spec.title, { size: 22, weight: 'bold', after: 14 })
  let numberedCounter = 0
  for (const block of spec.blocks) {
    if (block.type === 'heading') {
      y -= block.level === 1 ? 8 : 4
      text(block.text, { size: [16, 13, 11.5][block.level - 1]!, weight: 'bold', after: 6, keepWithNext: true })
    } else if (block.type === 'paragraph') {
      text(block.text, { size: 11, after: 8 })
    } else if (block.type === 'bullets') {
      for (const item of block.items) text(item, { size: 11, indent: 18, after: 3, first: '•' })
      y -= 5
    } else if (block.type === 'numbered') {
      numberedCounter = 0
      for (const item of block.items) text(item, { size: 11, indent: 22, after: 3, first: `${++numberedCounter}.` })
      y -= 5
    } else if (block.type === 'table') {
      drawTable(block)
    }
  }

  const pages = pdf.getPages()
  pages.forEach((p, i) => {
    const label = `${i + 1} / ${pages.length}`
    drawLine(p, label, PAGE.width - PAGE.margin - widthOf('regular', label, 8.5), PAGE.margin - 12, 'regular', 8.5, MUTED)
  })
  return await pdf.save()
}
