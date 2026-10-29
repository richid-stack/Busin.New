import { defineHandler, HTTPError } from 'nitro'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { VOICE_LIMITS } from '../../../../shared/voice'
import { listenFor } from '../../../services/voice/speech'

/** A recording in the request body (as sent, not a form), the words said out. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'voice-listen', user.id, 120, 10 * 60_000)
  const declared = Number(event.req.headers.get('content-length') || 0)
  if (declared > VOICE_LIMITS.listenBytes) throw new HTTPError({ statusCode: 413, statusMessage: 'That recording is too long. Say a little less at a time.' })
  const audio = new Uint8Array(await event.req.arrayBuffer())
  return await listenFor(user.id, audio, { signal: event.req.signal })
})
