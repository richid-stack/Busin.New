import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { getWorkflow, deleteWorkflow, resolveWorkflowId } from '../../../utils/firebase'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const userId = user.id

  const { id: requestedId } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)
  const id = resolveWorkflowId(userId, requestedId)

  const existing = await getWorkflow(id)
  if (!existing || existing.userId !== userId) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found or access denied' })
  }

  await deleteWorkflow(id)

  return {
    success: true,
    id
  }
})
