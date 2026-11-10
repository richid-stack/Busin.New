import type { ArtifactView, DocumentContent, PartSelection } from '../types/artifacts'

const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text)

/** A short plain name for the part the person picked, used at the start of the line they send: "Timeline: make it eight weeks". */
export function partLabel(file: ArtifactView, sel: PartSelection): string {
  if (file.kind === 'presentation') return `Slide ${sel.from}`
  if (file.kind === 'workbook') return sel.from === sel.to ? `Row ${sel.from}` : `Rows ${sel.from} to ${sel.to}`
  const block = (file.spec as DocumentContent).blocks[sel.from - 1]
  if (!block) return 'This part'
  if (block.type === 'heading') return block.text
  if (block.type === 'paragraph') return `“${short(block.text, 40)}”`
  return block.type === 'table' ? 'The table' : 'The list'
}

/** The line a person sees as their message when they ask for a change to a part. */
export const changeMessage = (label: string, request: string) => `${label}: ${request.trim()}`

/** For a document: the blocks a click on block `i` means. A heading takes the blocks under it, up to the next heading of the same or higher level. */
export function documentRange(blocks: DocumentContent['blocks'], i: number): { from: number, to: number } {
  const block = blocks[i]
  if (!block) return { from: i + 1, to: i + 1 }
  if (block.type !== 'heading') return { from: i + 1, to: i + 1 }
  let end = i + 1
  while (end < blocks.length) {
    const next = blocks[end]!
    if (next.type === 'heading' && next.level <= block.level) break
    end++
  }
  return { from: i + 1, to: end }
}
