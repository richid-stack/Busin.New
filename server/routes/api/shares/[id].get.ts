import { defineHandler } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { getVerifiedUser } from '../../../utils/session'
import { enforceRateLimit, rateLimitSubject } from '../../../utils/rateLimit'
import { publicShare, shareStore } from '../../../services/reef/share'
import { shareHttpError } from '../../../services/reef/http'

/** A shared page. Anyone with the link can read it, signed in or not. */
export default defineHandler(async (event) => {
  const user = await getVerifiedUser(event).catch(() => null)
  enforceRateLimit(event, 'share-read', rateLimitSubject(event, user?.id), 120, 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(8).max(64) }).parse)
  try {
    return publicShare(await shareStore().get(id, user?.id))
  } catch (err) {
    shareHttpError(err)
  }
})
