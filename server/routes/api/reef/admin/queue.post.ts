import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../../utils/reefRoute'

export default reefHandler({ auth: 'admin', limit: WRITE('reef-admin', 120, 60_000) }, async ({ event, reef }) => {
  const body = await readValidatedBody(event, z.object({ targetType: z.enum(['project', 'post']), targetId: z.string().max(100), action: z.enum(['restore', 'remove']) }).parse)
  await reef.moderation.resolve(body.targetType, body.targetId, body.action)
  return { success: true }
})
