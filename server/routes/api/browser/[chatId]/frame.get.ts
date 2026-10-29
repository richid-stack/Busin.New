import { defineHandler } from 'nitro'
import { createError } from 'nitro/h3'
import { browserCall, browserFor } from '../../../../utils/browserAccess'

/** The live picture of the page, as a JPEG. Polled by the browser card while it is open. */
export default defineHandler(async (event) => {
  const { service, key } = await browserFor(event, 400)
  const frame = await browserCall(() => service.frame(key))
  if (!frame) throw createError({ statusCode: 404, statusMessage: 'No page is open.' })
  return new Response(frame.bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Width': String(frame.width),
      'X-Height': String(frame.height),
      'X-Control': frame.control,
      'X-Url': encodeURIComponent(frame.url),
      'X-Title': encodeURIComponent(frame.title)
    }
  })
})
