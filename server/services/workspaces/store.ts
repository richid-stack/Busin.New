import { randomUUID } from 'node:crypto'
import { assertNotDeleting } from '../account/tombstone'
import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { readPowers } from '../../../shared/powers'
import { MAX_FILES, MAX_FILE_CHARS, MAX_NOTES, MAX_TOTAL_CHARS, MAX_WORKSPACES, WorkspaceError, fileInputSchema, fitText, noteInputSchema, whereInputSchema, workspaceInputSchema, workspacePatchSchema } from './profile'
import type { FileSource, NoteAuthor, WhereWeAre, Workspace, WorkspaceFile, WorkspaceFileInfo, WorkspaceInput, WorkspaceNote, WorkspacePatch } from './profile'

export const WORKSPACES = 'workspaces'
export const WORKSPACE_FILES = 'workspace_files'
export const WORKSPACE_NOTES = 'workspace_notes'

/** The slice of Firestore this store needs, so it can be tested on an in-memory stand-in. */
export type WorkspaceDb = any

export function workspaceFromDoc(id: string, data: Record<string, any>): Workspace {
  // Hand-edited or older documents are read through the same rules as new ones, falling back to safe values.
  const parsed = workspaceInputSchema.safeParse({
    name: data.name || 'Workspace',
    instructions: data.instructions || '',
    icon: data.icon,
    useMemory: data.useMemory,
    agentId: data.agentId ?? null,
    pinned: data.pinned === true
  })
  const input: WorkspaceInput = parsed.success ? parsed.data : workspaceInputSchema.parse({ name: 'Workspace' })
  const createdAt = String(data.createdAt || '')
  const where = data.whereWeAre && typeof data.whereWeAre === 'object' && typeof data.whereWeAre.text === 'string' && data.whereWeAre.text.trim()
    ? { text: String(data.whereWeAre.text), by: (data.whereWeAre.by === 'you' ? 'you' : 'assistant') as NoteAuthor, at: String(data.whereWeAre.at || '') }
    : null
  return { ...input, powers: readPowers(data.powers), whereWeAre: where, id, userId: String(data.userId || ''), createdAt, updatedAt: String(data.updatedAt || createdAt), lastUsedAt: String(data.lastUsedAt || data.updatedAt || createdAt) }
}

function fileFromDoc(id: string, data: Record<string, any>): WorkspaceFile {
  return {
    id,
    workspaceId: String(data.workspaceId || ''),
    userId: String(data.userId || ''),
    name: String(data.name || 'file'),
    source: (['upload', 'text', 'github', 'reef'] as const).includes(data.source) ? data.source : 'text',
    ...(data.from ? { from: String(data.from) } : {}),
    chars: Number(data.chars) || String(data.text || '').length,
    cut: data.cut === true,
    createdAt: String(data.createdAt || '')
  }
}

export const toInfo = (f: WorkspaceFile): WorkspaceFileInfo => ({ id: f.id, workspaceId: f.workspaceId, name: f.name, source: f.source, ...(f.from ? { from: f.from } : {}), chars: f.chars, cut: f.cut, createdAt: f.createdAt })

function noteFromDoc(id: string, data: Record<string, any>): WorkspaceNote {
  return { id, workspaceId: String(data.workspaceId || ''), text: String(data.text || ''), by: data.by === 'you' ? 'you' : 'assistant', createdAt: String(data.createdAt || '') }
}

const oneLineName = (name: string) => name.replace(/\s+/g, ' ').trim()

/** The rules for adding one more file, in plain words. */
function room(existing: WorkspaceFile[], name: string, chars: number): void {
  if (existing.length >= MAX_FILES) throw new WorkspaceError(`A workspace holds up to ${MAX_FILES} files. Remove one to add another.`, 409)
  if (existing.some(f => f.name.toLowerCase() === name.toLowerCase())) throw new WorkspaceError('A file with that name is already here.', 409)
  if (existing.reduce((n, f) => n + f.chars, 0) + chars > MAX_TOTAL_CHARS) throw new WorkspaceError('This workspace is out of space. Remove a file to make room.', 409)
}

export function createWorkspaceStore(db: WorkspaceDb, now: () => Date = () => new Date()) {
  const ws = () => db.collection(WORKSPACES)
  const wf = () => db.collection(WORKSPACE_FILES)
  const wn = () => db.collection(WORKSPACE_NOTES)

  /** A workspace that exists and belongs to this person; anything else is "not found" so ids cannot be probed. */
  async function owned(userId: string, id: string): Promise<Workspace> {
    const doc = await ws().doc(id).get()
    if (!doc.exists || String(doc.data()!.userId) !== userId) throw new WorkspaceError('Workspace not found', 404)
    return workspaceFromDoc(doc.id, doc.data()!)
  }

  async function filesOf(userId: string, workspaceId: string): Promise<WorkspaceFile[]> {
    const snap = await wf().where('workspaceId', '==', workspaceId).get()
    return snap.docs
      .filter((d: any) => String(d.data().userId) === userId)
      .map((d: any) => fileFromDoc(d.id, d.data()))
      .sort((a: WorkspaceFile, b: WorkspaceFile) => a.createdAt.localeCompare(b.createdAt))
  }

  async function notesOf(userId: string, workspaceId: string): Promise<WorkspaceNote[]> {
    const snap = await wn().where('workspaceId', '==', workspaceId).get()
    return snap.docs
      .filter((d: any) => String(d.data().userId) === userId)
      .map((d: any) => noteFromDoc(d.id, d.data()))
      .sort((a: WorkspaceNote, b: WorkspaceNote) => a.createdAt.localeCompare(b.createdAt))
  }

  return {
    owned,

    async list(userId: string): Promise<Workspace[]> {
      const snap = await ws().where('userId', '==', userId).get()
      return snap.docs.map((d: any) => workspaceFromDoc(d.id, d.data())).sort((a: Workspace, b: Workspace) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    },

    async get(userId: string, id: string): Promise<Workspace | null> {
      return await owned(userId, id).catch((err) => { if (err instanceof WorkspaceError) return null; throw err })
    },

    async create(userId: string, raw: unknown): Promise<Workspace> {
      await assertNotDeleting(userId, db)
      const input = workspaceInputSchema.parse(raw)
      if ((await this.list(userId)).length >= MAX_WORKSPACES) throw new WorkspaceError(`You can keep up to ${MAX_WORKSPACES} workspaces. Delete one to add another.`, 409)
      const stamp = now().toISOString()
      const ref = ws().doc()
      const doc = { ...input, userId, createdAt: stamp, updatedAt: stamp, lastUsedAt: stamp }
      await ref.set(doc)
      return workspaceFromDoc(ref.id, doc)
    },

    async update(userId: string, id: string, raw: unknown): Promise<Workspace> {
      const patch: WorkspacePatch = workspacePatchSchema.parse(raw)
      const existing = await owned(userId, id)
      const stamp = now().toISOString()
      const { powers: powersPatch, ...rest } = patch
      // Only the powers that were sent change; the rest stay as they were.
      const powers = powersPatch ? readPowers({ ...existing.powers, ...powersPatch }) : existing.powers
      await ws().doc(id).update({ ...rest, ...(powersPatch ? { powers } : {}), updatedAt: stamp })
      return { ...existing, ...rest, powers, updatedAt: stamp }
    },

    /** Marks the workspace as just used, so the list shows it first. Never throws: it is housekeeping. */
    async touch(userId: string, id: string): Promise<void> {
      try {
        await owned(userId, id)
        await ws().doc(id).update({ lastUsedAt: now().toISOString() })
      } catch { /* the chat matters more than the timestamp */ }
    },

    async remove(userId: string, id: string): Promise<void> {
      await owned(userId, id)
      for (const f of await filesOf(userId, id)) await wf().doc(f.id).delete()
      for (const n of await notesOf(userId, id)) await wn().doc(n.id).delete()
      await ws().doc(id).delete()
    },

    /** Takes an agent out of every workspace that used it, so a deleted agent does not linger. */
    async forgetAgent(userId: string, agentId: string): Promise<void> {
      const snap = await ws().where('userId', '==', userId).get()
      for (const d of snap.docs) if (d.data().agentId === agentId) await ws().doc(d.id).update({ agentId: null })
    },

    async listFiles(userId: string, workspaceId: string): Promise<{ files: WorkspaceFileInfo[], usedChars: number, limitChars: number, maxFiles: number }> {
      await owned(userId, workspaceId)
      const files = await filesOf(userId, workspaceId)
      return { files: files.map(toInfo), usedChars: files.reduce((n, f) => n + f.chars, 0), limitChars: MAX_TOTAL_CHARS, maxFiles: MAX_FILES }
    },

    /** Says whether a file of this size can be added, with the same plain errors addFile gives. Used before anything else is changed. */
    async assertRoom(userId: string, workspaceId: string, name: string, chars: number): Promise<void> {
      await owned(userId, workspaceId)
      room(await filesOf(userId, workspaceId), oneLineName(name), Math.min(chars, MAX_FILE_CHARS))
    },

    async addFile(userId: string, workspaceId: string, raw: { name: string, text: string }, source: FileSource, from?: string): Promise<WorkspaceFileInfo> {
      await assertNotDeleting(userId, db)
      await owned(userId, workspaceId)
      const input = fileInputSchema.parse(raw)
      const existing = await filesOf(userId, workspaceId)
      const { text, cut } = fitText(input.text)
      room(existing, input.name, text.length)
      const id = randomUUID()
      const doc = { userId, workspaceId, name: input.name, source, ...(from ? { from } : {}), text, chars: text.length, cut, createdAt: now().toISOString() }
      await wf().doc(id).set(doc)
      await ws().doc(workspaceId).update({ updatedAt: now().toISOString() })
      return toInfo(fileFromDoc(id, doc))
    },

    async removeFile(userId: string, workspaceId: string, fileId: string): Promise<void> {
      await owned(userId, workspaceId)
      const doc = await wf().doc(fileId).get()
      if (!doc.exists || String(doc.data()!.userId) !== userId || String(doc.data()!.workspaceId) !== workspaceId) throw new WorkspaceError('File not found', 404)
      await wf().doc(fileId).delete()
      await ws().doc(workspaceId).update({ updatedAt: now().toISOString() })
    },

    /** The notes of a workspace, oldest first, and its "where we are" summary. */
    async listNotes(userId: string, workspaceId: string): Promise<{ notes: WorkspaceNote[], whereWeAre: WhereWeAre | null, maxNotes: number }> {
      const workspace = await owned(userId, workspaceId)
      return { notes: await notesOf(userId, workspaceId), whereWeAre: workspace.whereWeAre, maxNotes: MAX_NOTES }
    },

    /**
     * Saves one short note. The same sentence twice is saved once. When the workspace is full the note is not
     * saved and the caller is told, so nothing is thrown away without the person knowing.
     */
    async addNote(userId: string, workspaceId: string, raw: unknown, by: NoteAuthor): Promise<{ status: 'saved' | 'exists', note: WorkspaceNote }> {
      await assertNotDeleting(userId, db)
      await owned(userId, workspaceId)
      const { text } = noteInputSchema.parse(raw)
      const existing = await notesOf(userId, workspaceId)
      const same = existing.find(n => n.text.toLowerCase() === text.toLowerCase())
      if (same) return { status: 'exists', note: same }
      if (existing.length >= MAX_NOTES) throw new WorkspaceError(`This workspace keeps up to ${MAX_NOTES} notes. Delete one to add another.`, 409)
      const id = randomUUID()
      const doc = { userId, workspaceId, text, by, createdAt: now().toISOString() }
      await wn().doc(id).set(doc)
      return { status: 'saved', note: noteFromDoc(id, doc) }
    },

    async removeNote(userId: string, workspaceId: string, noteId: string): Promise<void> {
      await owned(userId, workspaceId)
      const doc = await wn().doc(noteId).get()
      if (!doc.exists || String(doc.data()!.userId) !== userId || String(doc.data()!.workspaceId) !== workspaceId) throw new WorkspaceError('Note not found', 404)
      await wn().doc(noteId).delete()
    },

    /** Replaces the summary. An empty text clears it. */
    async setWhereWeAre(userId: string, workspaceId: string, raw: unknown, by: NoteAuthor): Promise<WhereWeAre | null> {
      await assertNotDeleting(userId, db)
      await owned(userId, workspaceId)
      const { text } = whereInputSchema.parse(raw)
      const value = text ? { text, by, at: now().toISOString() } : null
      await ws().doc(workspaceId).update({ whereWeAre: value })
      return value
    },

    notesFor: notesOf,

    /** The text of one file, found by its name. Null when there is no such file in this workspace. */
    async readFile(userId: string, workspaceId: string, name: string): Promise<{ name: string, text: string, cut: boolean } | null> {
      const want = name.trim().toLowerCase()
      const snap = await wf().where('workspaceId', '==', workspaceId).get()
      const hit = snap.docs.find((d: any) => String(d.data().userId) === userId && String(d.data().name).toLowerCase() === want)
      return hit ? { name: String(hit.data().name), text: String(hit.data().text || ''), cut: hit.data().cut === true } : null
    },

    filesForPrompt: filesOf
  }
}

let shared: ReturnType<typeof createWorkspaceStore> | undefined
/** The store backed by the real database. Created on first use. */
export const workspaceStore = () => (shared ??= createWorkspaceStore(getFirebaseDb()))
