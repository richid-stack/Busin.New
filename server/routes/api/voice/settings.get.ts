import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { getVoiceSettings, listVoiceKeys } from '../../../services/voice/store'
import { getConnection } from '../../../services/models/store'

/** What the person chose, which services have a voice key saved, and which chat keys can be reused for voice. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'voice-settings', user.id, 60, 60_000)
  const [settings, keys, openai, google, groq] = await Promise.all([
    getVoiceSettings(user.id),
    listVoiceKeys(user.id),
    getConnection(user.id, 'openai').catch(() => null),
    getConnection(user.id, 'google').catch(() => null),
    getConnection(user.id, 'groq').catch(() => null)
  ])
  return { settings, keys, fromChat: { openai: Boolean(openai), google: Boolean(google), groq: Boolean(groq) } }
})
