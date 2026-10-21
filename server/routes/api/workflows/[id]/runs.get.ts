import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { getWorkflow, getWorkflowRuns } from '../../../../utils/firebase'

export default defineHandler(async (event) => {
  const user = await requireUser(event)

  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)

  const workflow = await getWorkflow(id)
  if (!workflow || workflow.userId !== user.id) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  return await getWorkflowRuns(id)
})
