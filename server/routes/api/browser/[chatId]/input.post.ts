import { defineHandler } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { userInputSchema } from '../../../../services/browser/model'
import { browserCall, browserFor } from '../../../../utils/browserAccess'

/** One thing the person does on the page while they hold it: a click, some typing, a key, a scroll. Never logged. */
export default defineHandler(async (event) => {
  const { service, key } = await browserFor(event, 600)
  const { input } = await readValidatedBody(event, z.object({ input: userInputSchema }).parse)
  await browserCall(() => service.input(key, input))
  return { ok: true }
})
