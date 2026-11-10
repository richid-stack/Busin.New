import { defineHandler } from 'nitro'
import { createError, getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { getArtifact } from '../../../services/artifacts/store'

/** A file the person opened beside the chat, at the version being shown. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().max(64) }).parse)
  const file = await getArtifact(user.id, id)
  if (!file) throw createError({ statusCode: 404, statusMessage: 'This file was not found. It may have expired.' })
  event.res.headers.set('Cache-Control', 'private, no-store')
  return file
})
