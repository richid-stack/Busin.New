import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../../../utils/reefRoute'
import { REPORT_REASONS } from '../../../../../services/reef/model'

export default reefHandler({ auth: 'required', limit: WRITE('reef-report', 20) }, async ({ event, me, reef }) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(64) }).parse)
  const body = await readValidatedBody(event, z.object({ reason: z.enum(REPORT_REASONS), note: z.string().max(300).default('') }).parse)
  return await reef.moderation.report(me.id, 'post', id, body.reason, body.note)
})
