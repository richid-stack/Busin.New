import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { clearMemories } from '../../../services/memory/store'

/** Forgets everything. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'memory-write', user.id, 60, 10 * 60_000)
  return { removed: await clearMemories(user.id) }
})
