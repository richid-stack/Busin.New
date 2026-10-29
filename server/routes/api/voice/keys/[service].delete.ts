import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { voiceService } from '../../../../../shared/voice'
import { deleteVoiceKey } from '../../../../services/voice/store'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'voice-key', user.id, 20, 10 * 60_000)
  const { service } = await getValidatedRouterParams(event, z.object({ service: z.string().max(20) }).parse)
  const def = voiceService(service)
  if (!def) throw new HTTPError({ statusCode: 404, statusMessage: 'Unknown voice service.' })
  await deleteVoiceKey(user.id, def.id)
  return { success: true }
})
