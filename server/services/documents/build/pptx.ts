import PptxGenJS from 'pptxgenjs'
import type { PresentationSpec } from './spec'
import { clean } from './spec'

const INK = '1F2430'
const MUTED = '6B7280'
const ACCENT = '2563EB'
const FONT = 'Calibri'

export async function buildPptx(spec: PresentationSpec): Promise<Uint8Array> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9' // 10 x 5.625 in
  pptx.title = clean(spec.title)
  pptx.author = 'OpenLobs'
  pptx.company = 'OpenLobs'

  for (const slide of spec.slides) {
    const s = pptx.addSlide()
    s.background = { color: 'FFFFFF' }

    if (slide.layout === 'title') {
      s.addShape('rect', { x: 0, y: 0, w: 0.25, h: 5.625, fill: { color: ACCENT }, line: { color: ACCENT } })
      s.addText(clean(slide.title), { x: 0.9, y: 1.7, w: 8.2, h: 1.4, fontFace: FONT, fontSize: 38, bold: true, color: INK, valign: 'bottom', fit: 'shrink' })
      if (slide.subtitle) s.addText(clean(slide.subtitle), { x: 0.9, y: 3.2, w: 8.2, h: 0.9, fontFace: FONT, fontSize: 20, color: MUTED, valign: 'top', fit: 'shrink' })
    } else {
      s.addText(clean(slide.title), { x: 0.6, y: 0.35, w: 8.8, h: 0.8, fontFace: FONT, fontSize: 28, bold: true, color: INK, valign: 'middle', fit: 'shrink' })
      s.addShape('rect', { x: 0.6, y: 1.2, w: 0.9, h: 0.06, fill: { color: ACCENT }, line: { color: ACCENT } })

      if (slide.layout === 'content') {
        if (slide.bullets?.length) {
          const long = slide.bullets.length > 5 || slide.bullets.some(b => b.length > 110)
          s.addText(
            slide.bullets.map(b => ({ text: clean(b), options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } })),
            { x: 0.6, y: 1.5, w: 8.8, h: 3.6, fontFace: FONT, fontSize: long ? 16 : 20, color: INK, valign: 'top', fit: 'shrink' }
          )
        } else if (slide.text) {
          s.addText(clean(slide.text), { x: 0.6, y: 1.5, w: 8.8, h: 3.6, fontFace: FONT, fontSize: 18, color: INK, valign: 'top', fit: 'shrink' })
        }
      } else {
        const columns = slide.header.length
        const cell = (text: string, header: boolean) => ({
          text: clean(text),
          options: { bold: header, color: INK, fill: header ? { color: 'E8ECF1' } : undefined, fontFace: FONT, fontSize: slide.rows.length <= 6 ? 16 : slide.rows.length <= 9 ? 14 : 12, valign: 'middle' as const }
        })
        const rows = [
          slide.header.map(h => cell(h, true)),
          ...slide.rows.map(r => Array.from({ length: columns }, (_, c) => cell(r[c] ?? '', false)))
        ]
        s.addTable(rows, { x: 0.6, y: 1.5, w: 8.8, colW: Array(columns).fill(8.8 / columns), border: { type: 'solid', pt: 0.5, color: 'D1D5DB' }, margin: 0.06 })
      }
    }
    if (slide.notes) s.addNotes(clean(slide.notes))
  }
  const out = await pptx.write({ outputType: 'nodebuffer' })
  return new Uint8Array(out as Buffer)
}
