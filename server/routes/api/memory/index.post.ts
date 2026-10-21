import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { addMemory } from '../../../services/memory/store'
import { MemoryError } from '../../../services/memory/memory'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'memory-write', user.id, 60, 10 * 60_000)
  const { text } = await readValidatedBody(event, body => z.object({ text: z.string().max(2000) }).parse(body))
  try {
    return (await addMemory(user.id, text, 'user')).item
  } catch (err) {
    if (err instanceof MemoryError) throw new HTTPError({ statusCode: 400, statusMessage: err.message })
    throw err
  }
})
