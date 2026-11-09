import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { getConnection } from '../../../services/models/store'
import { viewConnection } from '../../../services/models/view'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(40) }).parse)
  const connection = await getConnection(user.id, id)
  if (!connection) throw new HTTPError({ statusCode: 404, statusMessage: 'Not connected.' })
  return viewConnection(connection)
})
