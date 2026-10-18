import { defineHandler } from 'nitro'
import { createError, getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { fileStore } from '../../../services/files'

/** Download a file OpenLobs created for the signed-in user. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().max(64) }).parse)

  const file = await fileStore().get(id, user.id)
  if (!file) throw createError({ statusCode: 404, statusMessage: 'This file was not found. It may have expired.' })

  // Latin-only fallback name plus the UTF-8 name, so any browser saves it under the right name.
  const ascii = file.name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return new Response(file.bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store'
    }
  })
})
