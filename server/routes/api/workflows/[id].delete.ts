import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { useUserSession } from '../../../utils/session'
import { getWorkflow, deleteWorkflow } from '../../../utils/firebase'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)
  const userId = session.data.user?.id || session.id!

  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)

  const existing = await getWorkflow(id)
  if (!existing || (existing.userId !== userId && existing.userId !== 'system')) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found or access denied' })
  }

  await deleteWorkflow(id)

  return {
    success: true,
    id
  }
})
