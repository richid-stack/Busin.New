import { defineHandler } from 'nitro'
import { createError, getValidatedQuery, getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { getArtifact, getVersionSpec } from '../../../services/artifacts/store'

/** A file the person opened beside the chat, at the version being shown. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().max(64) }).parse)
  const { version } = await getValidatedQuery(event, z.object({ version: z.coerce.number().int().min(1).max(100_000).optional() }).parse)
  // An older version, to show what changed since it. Just the content, only for a version that is still kept.
  if (version !== undefined) {
    const spec = await getVersionSpec(user.id, id, version)
    if (!spec) throw createError({ statusCode: 404, statusMessage: 'That version is no longer kept.' })
    event.res.headers.set('Cache-Control', 'private, no-store')
    return { version, spec }
  }
  const file = await getArtifact(user.id, id)
  if (!file) throw createError({ statusCode: 404, statusMessage: 'This file was not found. It may have expired.' })
  event.res.headers.set('Cache-Control', 'private, no-store')
  return file
})
