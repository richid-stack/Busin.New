import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { enforceRateLimit, rateLimitSubject } from '../../utils/rateLimit'
import { formatBrowserError, writeEntry } from '../../services/monitoring/report'

/**
 * Lets the app tell the server that something broke in someone's browser. Open to signed-out visitors
 * (a broken sign-in page is worth knowing about), so it is small, rate limited and logs a warning only.
 */
export default defineHandler(async (event) => {
  enforceRateLimit(event, 'client-errors', rateLimitSubject(event), 20, 10 * 60_000)

  const body = await readValidatedBody(event, z.object({
    message: z.string().max(2000),
    stack: z.string().max(8000).optional(),
    page: z.string().max(500).optional(),
    kind: z.string().max(40).optional()
  }).parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Invalid report' })
  })

  writeEntry(formatBrowserError(body))
  return { ok: true }
})
