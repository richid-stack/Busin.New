import { defineHandler } from 'nitro'
import { createError, getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { ArtifactGone, moveHead } from '../../../../services/artifacts/store'

/** Undo and redo: step to another version that is still kept. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'artifact-move', user.id, 60, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().max(64) }).parse)
  const { version } = await readValidatedBody(event, z.object({ version: z.number().int().min(1).max(1_000_000) }).parse)
  try {
    return await moveHead(user.id, id, version)
  } catch (err: any) {
    if (err instanceof ArtifactGone) throw createError({ statusCode: 404, statusMessage: err.message })
    throw err
  }
})
