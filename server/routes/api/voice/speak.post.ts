import { defineHandler } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { speakFor } from '../../../services/voice/speech'

/** One short piece of text in, spoken audio out. Lobby calls it a sentence at a time. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  // A long talk is many short calls, so this allows a real conversation but stops a loop.
  enforceRateLimit(event, 'voice-speak', user.id, 240, 10 * 60_000)
  const { text } = await readValidatedBody(event, b => z.object({ text: z.string().min(1).max(2000) }).parse(b))
  const { audio, mediaType } = await speakFor(user.id, text, { signal: event.req.signal })
  return new Response(audio as unknown as BodyInit, { headers: { 'content-type': mediaType, 'cache-control': 'no-store' } })
})
