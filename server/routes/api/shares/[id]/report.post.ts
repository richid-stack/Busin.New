import { defineHandler } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { REPORT_REASONS, SHARE_LIMITS, shareStore } from '../../../../services/reef/share'
import { shareHttpError } from '../../../../services/reef/http'

/** Reports a shared page. Several different people reporting it hides it until it has been looked at. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'share-report', user.id, 10, 60 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(8).max(64) }).parse)
  const body = await readValidatedBody(event, z.object({ reason: z.enum(REPORT_REASONS), note: z.string().max(SHARE_LIMITS.noteMax).default('') }).parse)
  try {
    await shareStore().report(user.id, id, body.reason, body.note)
    return { success: true }
  } catch (err) {
    shareHttpError(err)
  }
})
