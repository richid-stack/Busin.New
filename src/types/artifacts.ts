export type ArtifactKind = 'document' | 'workbook' | 'presentation'

export type DocBlock =
  | { type: 'heading', text: string, level: number }
  | { type: 'paragraph', text: string }
  | { type: 'bullets' | 'numbered', items: string[] }
  | { type: 'table', header: string[], rows: string[][] }
export interface DocumentContent { title: string, blocks: DocBlock[] }

export type SheetCell = string | number | boolean | null | { formula: string }
export interface SheetContent { name: string, header: string[], rows: SheetCell[][], formats?: string[] }
export interface WorkbookContent { title: string, sheets: SheetContent[] }

export type Slide =
  | { layout: 'title', title: string, subtitle?: string }
  | { layout: 'content', title: string, bullets?: string[], text?: string }
  | { layout: 'table', title: string, header: string[], rows: string[][] }
export interface PresentationContent { title: string, slides: Slide[] }

/** What the person has picked in the open file. Numbers count from 1: blocks, rows or slides. */
export interface PartSelection {
  sheet?: number
  from: number
  to: number
  col?: number
}

export interface ArtifactView {
  id: string
  kind: ArtifactKind
  format: 'docx' | 'pdf' | 'xlsx' | 'pptx'
  title: string
  chatId: string | null
  head: number
  latest: number
  oldest: number
  updatedAt: string
  canUndo: boolean
  canRedo: boolean
  spec: DocumentContent | WorkbookContent | PresentationContent
}
