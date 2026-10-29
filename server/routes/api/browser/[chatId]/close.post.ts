import { defineHandler } from 'nitro'
import { browserCall, browserFor } from '../../../../utils/browserAccess'

/** Closes the browser for this chat: the person pressed Stop, or is done. */
export default defineHandler(async (event) => {
  const { service, key } = await browserFor(event, 30)
  await browserCall(() => service.close(key))
  return { ok: true }
})
