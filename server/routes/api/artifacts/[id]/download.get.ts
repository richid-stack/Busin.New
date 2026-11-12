import { defineHandler } from 'nitro'
import { createError, getValidatedQuery, getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { downloadArtifact } from '../../../../services/artifacts/download'

/** Download the file as it is on screen now. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'artifact-download', user.id, 30, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().max(64) }).parse)
  const { as } = await getValidatedQuery(event, z.object({ as: z.enum(['html']).optional() }).parse)
  const file = await downloadArtifact(user.id, id, as)
  if (!file) throw createError({ statusCode: 404, statusMessage: 'This file was not found. It may have expired.' })
  if ('problem' in file) throw createError({ statusCode: 422, statusMessage: file.problem })
  const ascii = file.name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return new Response(file.bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(file.bytes.length),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store'
    }
  })
})
