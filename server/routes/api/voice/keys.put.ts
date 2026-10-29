import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { seal } from '../../../utils/secretBox'
import { VOICE_SERVICES } from '../../../../shared/voice'
import { VOICE_KEY_PURPOSE } from '../../../services/voice/resolve'
import { KEYED_SERVICES, saveVoiceKey } from '../../../services/voice/store'

const body = z.object({
  service: z.string(),
  key: z.string().transform(k => k.replace(/[\u0000-\u001F\u007F\s]/g, '')).pipe(z.string().min(8, 'That key looks too short.').max(500, 'That key is too long.'))
})

/** Saves a key just for voice, sealed. It is not tested here: the first thing Lobby says with it is the test. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'voice-key', user.id, 20, 10 * 60_000)
  const input = await readValidatedBody(event, b => body.parse(b))
  const def = VOICE_SERVICES.find(s => s.id === input.service)
  if (!def || !(KEYED_SERVICES as string[]).includes(def.id)) throw new HTTPError({ statusCode: 400, statusMessage: 'Unknown voice service.' })
  await saveVoiceKey(user.id, def.id, seal(input.key, VOICE_KEY_PURPOSE), input.key.slice(-4))
  return { service: def.id, last4: input.key.slice(-4) }
})
