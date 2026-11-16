export const WORKSPACE_ICON_NAMES = ['palette', 'store', 'building-2', 'music', 'folder', 'briefcase', 'rocket', 'book-open'] as const
export type WorkspaceIconName = typeof WORKSPACE_ICON_NAMES[number]

export interface Workspace {
  id: string
  name: string
  instructions: string
  icon: WorkspaceIconName
  useMemory: boolean
  agentId: string | null
  pinned: boolean
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
