import { tool } from 'ai'
import { z, ZodError } from 'zod'
import { workspaceStore } from '../../services/workspaces/store'
import { MAX_NOTE_CHARS, MAX_WHERE_CHARS, WorkspaceError } from '../../services/workspaces/profile'
import { withToolLimits } from './limits'

type Store = Pick<ReturnType<typeof workspaceStore>, 'addNote' | 'setWhereWeAre'>

/**
 * Saves one short note into the workspace this chat belongs to, so any later chat there starts knowing it.
 * The workspace is fixed by the chat, never by the model.
 */
export function createSaveToNotesTool(userId: string, workspaceId: string, store: Store = workspaceStore()) {
  return tool({
    description: 'Save one short note to this workspace\'s notes, for a decision, a name, a preference, a deadline or what happens next. Every later chat in this workspace will read it. One plain sentence. Do not save small talk or anything already in the notes.',
    inputSchema: z.object({
      text: z.string().min(1).max(600).describe(`The note, one short plain sentence (at most ${MAX_NOTE_CHARS} characters)`)
    }),
    execute: withToolLimits(
      { name: 'save_to_notes', userId, perMinute: 20, timeoutMs: 15_000, maxResultChars: 2_000 },
      async ({ text }) => {
        try {
          const { status, note } = await store.addNote(userId, workspaceId, { text }, 'assistant')
          return { status, text: note.text, noteId: note.id, workspaceId }
        } catch (err) {
          if (err instanceof WorkspaceError) return { status: 'failed' as const, error: err.message, workspaceId }
          if (err instanceof ZodError) return { status: 'failed' as const, error: err.issues[0]?.message ?? 'That note is not valid.', workspaceId }
          throw err
        }
      }
    )
  })
}

/** Rewrites the short "where we are" summary of the workspace this chat belongs to. */
export function createUpdateWhereWeAreTool(userId: string, workspaceId: string, store: Store = workspaceStore()) {
  return tool({
    description: 'Rewrite the short "where we are" summary at the top of this workspace\'s notes: what is decided, what is done and what is next, in two or three plain sentences. It replaces the old summary, so keep what still matters.',
    inputSchema: z.object({
      text: z.string().min(1).max(2_000).describe(`The new summary, at most ${MAX_WHERE_CHARS} characters`)
    }),
    execute: withToolLimits(
      { name: 'update_where_we_are', userId, perMinute: 10, timeoutMs: 15_000, maxResultChars: 3_000 },
      async ({ text }) => {
        try {
          const saved = await store.setWhereWeAre(userId, workspaceId, { text }, 'assistant')
          return { status: 'updated' as const, text: saved?.text ?? '', workspaceId }
        } catch (err) {
          if (err instanceof WorkspaceError) return { status: 'failed' as const, error: err.message }
          if (err instanceof ZodError) return { status: 'failed' as const, error: err.issues[0]?.message ?? 'That summary is not valid.' }
          throw err
        }
      }
    )
  })
}
