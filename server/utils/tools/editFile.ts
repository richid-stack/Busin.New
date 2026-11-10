import { tool } from 'ai'
import { z } from 'zod'
import { applyChanges, changeSchema, EditError } from '../../services/artifacts/edit'
import { buildArtifactFile, outline } from '../../services/artifacts/model'
import { ArtifactGone, getArtifact, saveVersion } from '../../services/artifacts/store'
import { BuildError } from '../../services/documents/build/spec'
import { MAX_FILE_BYTES } from '../../services/files/store'
import { withToolLimits } from './limits'

export interface EditFileDeps {
  get: typeof getArtifact
  save: typeof saveVersion
}
const real: EditFileDeps = { get: getArtifact, save: saveVersion }

/** Changes one or a few parts of a file the assistant made earlier. The person can step back with undo. */
export function createEditFileTool(userId: string, deps: EditFileDeps = real) {
  return tool({
    description: 'Change parts of a file you created earlier (a Word or PDF document, a spreadsheet or a presentation) without writing it all again. Use the artifactId from when it was created, or from the file the user has open beside the chat. Numbers count from 1 and match the list of parts. Send only what changes. Every change is saved as a new version, and the user can go back with the undo arrow.',
    inputSchema: z.object({
      artifactId: z.string().min(36).max(36).describe('The artifactId of the file'),
      summary: z.string().min(1).max(120).describe('What this change does, in a few plain words, for example "Made the timeline eight weeks"'),
      changes: z.array(changeSchema).min(1).max(30)
    }),
    execute: withToolLimits({ name: 'edit_file', userId, perMinute: 12, timeoutMs: 20_000, maxResultChars: 4_000 }, async ({ artifactId, summary, changes }) => {
      const current = await deps.get(userId, artifactId)
      if (!current) return { status: 'failed' as const, error: 'This file was not found. It may have expired, so make a new one.' }
      try {
        const next = applyChanges(current.kind, current.spec, changes)
        // Build it once so a change that cannot become a file, or makes it too big, is refused before it is saved.
        const built = await buildArtifactFile(current.kind, current.format, next)
        if (built.bytes.length > MAX_FILE_BYTES) return { status: 'failed' as const, error: `The file would come out at ${Math.round(built.bytes.length / 1024)} KB, over the ${Math.round(MAX_FILE_BYTES / 1000)} KB limit. Make the content shorter.` }
        const saved = await deps.save(userId, artifactId, { spec: next, note: summary, title: next.title, expectedHead: current.head })
        return {
          status: 'ok' as const,
          artifactId,
          kind: saved.kind,
          title: saved.title,
          version: saved.head,
          parts: outline(saved.kind, next).slice(0, 60),
          message: 'The change is saved and shown beside the chat. Say what changed in one short sentence. The user can step back with the undo arrow at the top of the file.'
        }
      } catch (err: any) {
        if (err instanceof EditError || err instanceof BuildError || err instanceof ArtifactGone) return { status: 'failed' as const, error: `${err.message} Fix it and try again.` }
        throw err
      }
    })
  })
}
