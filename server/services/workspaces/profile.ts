import { z } from 'zod'

/** Most workspaces one person can keep. */
export const MAX_WORKSPACES = 8
export const MAX_RULES_CHARS = 2000
export const MAX_NAME_CHARS = 60
/** Most files one workspace holds. */
export const MAX_FILES = 6
/** Most text kept from one file; the rest is cut and the file is marked as cut. A Firestore document holds 1 MiB. */
export const MAX_FILE_CHARS = 200_000
/** The "space used" budget for one workspace, in characters of text across all its files. */
export const MAX_TOTAL_CHARS = 600_000
export const MAX_FILE_NAME_CHARS = 120

/** The pictures a workspace can wear. Written out so the icon bundle picks every one of them up. */
export const WORKSPACE_ICONS = ['palette', 'store', 'building-2', 'music', 'folder', 'briefcase', 'rocket', 'book-open'] as const
export type WorkspaceIcon = typeof WORKSPACE_ICONS[number]

const clean = (value: string) => value.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
const oneLine = (value: string) => clean(value).replace(/\s+/g, ' ')

const fields = {
  name: z.string().transform(oneLine).pipe(z.string().min(1, 'Give the workspace a name.').max(MAX_NAME_CHARS, `The name can be at most ${MAX_NAME_CHARS} characters.`)),
  instructions: z.string().transform(clean).pipe(z.string().max(MAX_RULES_CHARS, `The rules can be at most ${MAX_RULES_CHARS} characters.`)),
  icon: z.enum(WORKSPACE_ICONS),
  useMemory: z.boolean(),
  /** The saved agent chats in this workspace start with. Null means the standard assistant. */
  agentId: z.string().min(1).max(128).nullable(),
  pinned: z.boolean()
}

export const workspaceInputSchema = z.object({
  name: fields.name,
  instructions: fields.instructions.optional().default(''),
  icon: fields.icon.optional().default('folder'),
  useMemory: fields.useMemory.optional().default(true),
  agentId: fields.agentId.optional().default(null),
  pinned: fields.pinned.optional().default(false)
})
export type WorkspaceInput = z.infer<typeof workspaceInputSchema>

/**
 * Every field is optional when changing a workspace and has no default: what is not sent stays as it was.
 * What is sent goes through the same rules as a new workspace.
 */
export const workspacePatchSchema = z.object({
  name: fields.name.optional(),
  instructions: fields.instructions.optional(),
  icon: fields.icon.optional(),
  useMemory: fields.useMemory.optional(),
  agentId: fields.agentId.optional(),
  pinned: fields.pinned.optional()
}).refine(p => Object.values(p).some(v => v !== undefined), 'Nothing to change.')
export type WorkspacePatch = z.infer<typeof workspacePatchSchema>

export interface Workspace extends WorkspaceInput {
  id: string
  userId: string
  createdAt: string
  updatedAt: string
  /** When a chat last started or was added here; the list sorts by it. */
  lastUsedAt: string
}

export type FileSource = 'upload' | 'text' | 'github' | 'reef'

export interface WorkspaceFile {
  id: string
  workspaceId: string
  userId: string
  name: string
  source: FileSource
  /** Where it came from, e.g. "owner/repo" for GitHub. */
  from?: string
  chars: number
  /** True when the file was longer than the limit and only the start is kept. */
  cut: boolean
  createdAt: string
}

/** What the person sees: a file without its text. */
export type WorkspaceFileInfo = Omit<WorkspaceFile, 'userId'>

export const fileInputSchema = z.object({
  name: z.string().transform(oneLine).pipe(z.string().min(1, 'Give the file a name.').max(MAX_FILE_NAME_CHARS, `The file name can be at most ${MAX_FILE_NAME_CHARS} characters.`)),
  text: z.string().transform(clean).pipe(z.string().min(1, 'The file has no text.'))
})

export class WorkspaceError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

/** Cuts text at a line break near the limit so a paragraph is not split in the middle of a word. */
export function fitText(text: string, max = MAX_FILE_CHARS): { text: string, cut: boolean } {
  if (text.length <= max) return { text, cut: false }
  let end = max
  const lineBreak = text.lastIndexOf('\n', max)
  if (lineBreak > max * 0.8) end = lineBreak
  return { text: text.slice(0, end), cut: true }
}

/**
 * The part of a chat's instructions that comes from the workspace: its rules and the names of its files.
 * The files themselves are not pasted in; the model opens one with read_workspace_file when it needs it.
 */
export function workspacePrompt(workspace: Pick<Workspace, 'name' | 'instructions'>, files: Array<Pick<WorkspaceFile, 'name' | 'chars' | 'cut'>>): string {
  const lines = [`**WORKSPACE: ${workspace.name}**`, 'This chat belongs to a workspace the user set up for one client or job. Stay inside its context.']
  if (workspace.instructions) lines.push('Rules from the user for this workspace:', workspace.instructions)
  if (files.length) {
    lines.push(
      'Files in this workspace (open one with read_workspace_file when the work needs it; do not guess what a file says):',
      ...files.map(f => `- ${f.name} (${f.chars.toLocaleString('en-US')} characters${f.cut ? ', cut short' : ''})`)
    )
  }
  return lines.join('\n')
}
