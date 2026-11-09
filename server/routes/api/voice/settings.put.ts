import { defineHandler } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { saveVoiceSettings } from '../../../services/voice/store'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'voice-settings-save', user.id, 30, 10 * 60_000)
  const body = await readValidatedBody(event, b => z.object({}).passthrough().parse(b))
  return await saveVoiceSettings(user.id, body)
})
