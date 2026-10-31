import { defineHandler } from 'nitro'
import { browserCall, browserFor } from '../../../../utils/browserAccess'

/** Is a page open for this chat, where is it, and who holds it. */
export default defineHandler(async (event) => {
  const { service, key } = await browserFor(event, 120)
  return { session: await browserCall(() => service.status(key)) }
})
