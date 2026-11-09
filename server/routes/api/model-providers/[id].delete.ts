import { defineHandler } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { deleteConnection } from '../../../services/models/store'

/** Forgets the saved key and the models. Anything saved with one of these models falls back to the chat's model. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(40) }).parse)
  return { removed: await deleteConnection(user.id, id) }
})
