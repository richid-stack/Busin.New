import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { deleteMemory, getMemory } from '../../../services/memory/store'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'memory-write', user.id, 60, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const existing = await getMemory(id)
  if (!existing || existing.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Memory not found' })
  await deleteMemory(id)
  return { ok: true }
})
