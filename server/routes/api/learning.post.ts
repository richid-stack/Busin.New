import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../utils/session'
import { enforceRateLimit } from '../../utils/rateLimit'
import { saveLearning } from '../../services/learning/apply'

/** The person pressed Save on a suggestion. Nothing is kept before this. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'learning-write', user.id, 60, 10 * 60_000)
  const body = await readValidatedBody(event, b => z.object({
    kind: z.enum(['memory', 'agent']),
    text: z.string().min(1).max(2000),
    replaces: z.string().max(128).optional(),
    agentId: z.string().max(128).optional()
  }).parse(b))
  const result = await saveLearning(user.id, body)
  if (!result.ok) throw new HTTPError({ statusCode: result.status, statusMessage: result.error })
  return result.value
})
