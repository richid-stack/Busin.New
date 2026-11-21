import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { undoLearning } from '../../../services/learning/apply'

/** Takes a kept suggestion back. A replaced memory gets its old words again. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'learning-write', user.id, 60, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const body = await readValidatedBody(event, b => z.object({
    kind: z.enum(['memory', 'agent']),
    agentId: z.string().max(128).optional(),
    text: z.string().max(2000).optional(),
    restore: z.string().max(2000).optional()
  }).parse(b))
  const result = await undoLearning(user.id, id, body)
  if (!result.ok) throw new HTTPError({ statusCode: result.status, statusMessage: result.error })
  return { ok: true }
})
