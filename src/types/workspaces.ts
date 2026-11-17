export const WORKSPACE_ICON_NAMES = ['palette', 'store', 'building-2', 'music', 'folder', 'briefcase', 'rocket', 'book-open'] as const
export type WorkspaceIconName = typeof WORKSPACE_ICON_NAMES[number]

export type NoteAuthor = 'assistant' | 'you'
export type WorkspacePowers = { web: boolean, browser: boolean, computer: boolean, cloud: boolean, apps: boolean, notes: boolean }

export interface WhereWeAre { text: string, by: NoteAuthor, at: string }
export interface WorkspaceNote { id: string, workspaceId: string, text: string, by: NoteAuthor, createdAt: string }
export interface WorkspaceNotes { notes: WorkspaceNote[], whereWeAre: WhereWeAre | null, maxNotes: number }

export interface Workspace {
  id: string
  name: string
  instructions: string
  icon: WorkspaceIconName
  useMemory: boolean
  agentId: string | null
  pinned: boolean
  /** What the assistant may use in this workspace. A power is on only when Settings has it on too. */
  powers: WorkspacePowers
  whereWeAre: WhereWeAre | null
  createdAt: string
  updatedAt: string
  lastUsedAt: string
}

export interface WorkspaceFile {
  id: string
  workspaceId: string
  name: string
  source: 'upload' | 'text' | 'github' | 'reef'
  from?: string
  chars: number
  cut: boolean
  createdAt: string
}

export interface WorkspaceDetail {
  workspace: Workspace
  files: WorkspaceFile[]
  usedChars: number
  limitChars: number
  maxFiles: number
}
