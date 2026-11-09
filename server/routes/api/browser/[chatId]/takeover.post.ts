import { defineHandler } from 'nitro'
import { browserCall, browserFor } from '../../../../utils/browserAccess'

/** The person takes the page into their own hands: to sign in, solve a CAPTCHA or pay. The assistant waits. */
export default defineHandler(async (event) => {
  const { service, key } = await browserFor(event, 30)
  await browserCall(() => service.takeOver(key))
  return { ok: true }
})
