import { defineHandler } from 'nitro'
import { browserCall, browserFor } from '../../../../utils/browserAccess'

/** The person hands the page back. Nothing about what they typed is returned. */
export default defineHandler(async (event) => {
  const { service, key } = await browserFor(event, 30)
  const state = await browserCall(() => service.handBack(key))
  return { ok: true, url: state.url, title: state.title }
})
