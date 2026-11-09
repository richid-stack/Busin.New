import { defineHandler, HTTPError } from 'nitro'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { VOICE_LIMITS } from '../../../../shared/voice'
import { listenFor } from '../../../services/voice/speech'
import { readCapped } from '../../../utils/readCapped'

/** A recording in the request body (as sent, not a form), the words said out. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'voice-listen', user.id, 120, 10 * 60_000)
  const declared = Number(event.req.headers.get('content-length') || 0)
  if (declared > VOICE_LIMITS.listenBytes) throw new HTTPError({ statusCode: 413, statusMessage: 'That recording is too long. Say a little less at a time.' })
  // The header can be missing (chunked uploads), so the size is counted as the bytes arrive.
  const audio = await readCapped(event.req.body, VOICE_LIMITS.listenBytes)
  if (!audio) throw new HTTPError({ statusCode: 413, statusMessage: 'That recording is too long. Say a little less at a time.' })
  return await listenFor(user.id, audio, { signal: event.req.signal })
})
