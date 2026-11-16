import { defineHandler } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { DocumentError } from '../../../../services/documents/errors'
import { parseDataUrl } from '../../../../services/documents/dataUrl'
import { extractDocument } from '../../../../services/documents/extract'
import { workspaceStore } from '../../../../services/workspaces/store'
import { WorkspaceError } from '../../../../services/workspaces/profile'
import { workspaceRoute } from '../../../../utils/workspaceRoute'

const MAX_UPLOAD_BYTES = 900_000

/**
 * Adds a file to a workspace. Either text the person typed or pasted ({ name, text }), or an uploaded
 * file ({ name, url } with a data: URL) whose text is read here: PDF, Word, CSV, Markdown, JSON or text.
 */
export default defineHandler(event => workspaceRoute(async () => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'workspace-file', user.id, 40, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const body = await readValidatedBody(event, z.object({
    name: z.string().min(1).max(255),
    text: z.string().max(2_000_000).optional(),
    url: z.string().max(1_400_000).refine(u => /^data:/i.test(u), 'Upload a file').optional()
  }).refine(b => (b.text === undefined) !== (b.url === undefined), 'Send either text or a file.').parse)

  if (body.text !== undefined) return await workspaceStore().addFile(user.id, id, { name: body.name, text: body.text }, 'text')

  try {
    const { bytes, mediaType } = parseDataUrl(body.url!, MAX_UPLOAD_BYTES)
    const doc = await extractDocument(bytes, body.name, mediaType)
    return await workspaceStore().addFile(user.id, id, { name: body.name, text: doc.text }, 'upload')
  } catch (err) {
    if (err instanceof DocumentError) throw new WorkspaceError(err.message)
    throw err
  }
}))
