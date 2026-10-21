import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { getWorkflow, updateWorkflow, resolveWorkflowId } from '../../../../utils/firebase'
import { scheduleFieldsForSave } from '../../../../utils/workflowSchedule'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const userId = user.id

  const { id: requestedId } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)
  const id = resolveWorkflowId(userId, requestedId)

  const { status } = await readValidatedBody(event, z.object({
    status: z.enum(['active', 'draft', 'paused'])
  }).parse)

  const existing = await getWorkflow(id)
  
  if (!existing || existing.userId !== userId) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found or access denied' })
  }

  const schedule = await scheduleFieldsForSave(userId, id, existing, { status, nodes: existing.nodes })
  await updateWorkflow(id, { status, ...(schedule ?? {}) })

  return {
    success: true,
    id,
    status,
    ...(schedule ? { schedule: { nextRunAt: schedule.scheduleNextRunAt, error: schedule.scheduleError } } : {})
  }
})
