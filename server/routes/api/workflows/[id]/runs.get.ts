import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { getWorkflow, getWorkflowRuns, resolveWorkflowId } from '../../../../utils/firebase'

export default defineHandler(async (event) => {
  const user = await requireUser(event)

  const { id: requestedId } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)
  const id = resolveWorkflowId(user.id, requestedId)

  const workflow = await getWorkflow(id)
  if (!workflow || workflow.userId !== user.id) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  return await getWorkflowRuns(id)
})
