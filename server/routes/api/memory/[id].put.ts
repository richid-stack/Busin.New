import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { getMemory, updateMemory } from '../../../services/memory/store'
import { MemoryError } from '../../../services/memory/memory'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'memory-write', user.id, 60, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const { text } = await readValidatedBody(event, body => z.object({ text: z.string().max(2000) }).parse(body))
  const existing = await getMemory(id)
  if (!existing || existing.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Memory not found' })
  try {
    return { id: existing.id, source: existing.source, createdAt: existing.createdAt, text: await updateMemory(user.id, id, text) }
  } catch (err) {
    if (err instanceof MemoryError) throw new HTTPError({ statusCode: 400, statusMessage: err.message })
    throw err
  }
})
