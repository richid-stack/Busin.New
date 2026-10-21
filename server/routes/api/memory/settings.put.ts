import { defineHandler } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { setMemoryEnabled } from '../../../services/memory/store'

/** Switches memory on or off. Off means nothing is sent to the model and nothing can be saved; what is stored stays. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'memory-write', user.id, 60, 10 * 60_000)
  const { enabled } = await readValidatedBody(event, body => z.object({ enabled: z.boolean() }).parse(body))
  await setMemoryEnabled(user.id, enabled)
  return { enabled }
})
