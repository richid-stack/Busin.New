import { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import type { DocumentSpec } from './spec'
import { clean } from './spec'

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3]

/** Text with line breaks kept, as runs. Plain text only: no links, images or macros are ever written. */
function runs(text: string, options: { bold?: boolean } = {}): TextRun[] {
  return clean(text).split('\n').map((line, i) => new TextRun({ text: line, bold: options.bold, break: i > 0 ? 1 : undefined }))
}

export async function buildDocx(spec: DocumentSpec): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: runs(spec.title) })
  ]
  let listCounter = 0

  for (const block of spec.blocks) {
    if (block.type === 'heading') {
      children.push(new Paragraph({ heading: HEADINGS[block.level - 1], children: runs(block.text) }))
    } else if (block.type === 'paragraph') {
      children.push(new Paragraph({ spacing: { after: 140 }, children: runs(block.text) }))
    } else if (block.type === 'bullets') {
      for (const item of block.items) children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: runs(item) }))
    } else if (block.type === 'numbered') {
      // Each list is its own instance, so numbering restarts at 1.
      const instance = listCounter++
      for (const item of block.items) children.push(new Paragraph({ numbering: { reference: 'numbers', level: 0, instance }, children: runs(item) }))
    } else if (block.type === 'table') {
      const columns = block.header.length
      const row = (cells: string[], header: boolean) => new TableRow({
        tableHeader: header,
        children: Array.from({ length: columns }, (_, i) => new TableCell({
          width: { size: 100 / columns, type: WidthType.PERCENTAGE },
          shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E8ECF1' } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: runs(cells[i] ?? '', { bold: header }) })]
        }))
      })
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [row(block.header, true), ...block.rows.map(r => row(r, false))]
      }))
      children.push(new Paragraph({ children: [] }))
    }
  }

  const doc = new Document({
    title: clean(spec.title),
    creator: 'OpenLobs',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
        { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] }
      ]
    },
    sections: [{ children }]
  })
  return new Uint8Array(await Packer.toBuffer(doc))
}
