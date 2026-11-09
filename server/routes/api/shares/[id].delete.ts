import { defineHandler } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { shareStore } from '../../../services/reef/share'
import { shareHttpError } from '../../../services/reef/http'

/** Stops sharing. The link stops working; copies people already installed stay theirs. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'share-write', user.id, 20, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(8).max(64) }).parse)
  try {
    await shareStore().remove(user.id, id)
    return { success: true }
  } catch (err) {
    shareHttpError(err)
  }
})
