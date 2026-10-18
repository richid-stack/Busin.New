import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { getWorkflow, updateWorkflow, createWorkflow, resolveWorkflowId } from '../../../utils/firebase'
import { scheduleFieldsForSave } from '../../../utils/workflowSchedule'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const userId = user.id

  const { id: requestedId } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)
  const id = resolveWorkflowId(userId, requestedId)

  const body = await readValidatedBody(event, z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['active', 'draft', 'paused']).optional(),
    nodes: z.array(z.any()).optional(),
    edges: z.array(z.any()).optional(),
    nodeSchemas: z.record(z.string(), z.any()).optional()
  }).parse)

  let existing = await getWorkflow(id)
  if (!existing && id !== requestedId) {
    const schedule = await scheduleFieldsForSave(userId, id, null, { status: body.status || 'active', nodes: body.nodes || [] })
    existing = await createWorkflow({
      id,
      title: body.title || 'Client Onboarding Pipeline',
      description: body.description || 'Enterprise Client Onboarding Automation Pipeline',
      userId,
      nodes: body.nodes || [],
      edges: body.edges || [],
      nodeSchemas: body.nodeSchemas || {},
      status: body.status || 'active',
      scheduleNextRunAt: schedule?.scheduleNextRunAt ?? null
    })
    return {
      success: true,
      id,
      updatedAt: new Date().toISOString()
    }
  }

  if (!existing || existing.userId !== userId) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found or access denied' })
  }

  // Only a change to the nodes or the status can change the schedule.
  const touchesSchedule = body.nodes !== undefined || body.status !== undefined
  const schedule = touchesSchedule
    ? await scheduleFieldsForSave(userId, id, existing, { status: body.status ?? existing.status, nodes: body.nodes ?? existing.nodes })
    : null

  await updateWorkflow(id, { ...body, ...(schedule ?? {}) })

  return {
    success: true,
    id,
    updatedAt: new Date().toISOString(),
    ...(schedule ? { schedule: { nextRunAt: schedule.scheduleNextRunAt, error: schedule.scheduleError } } : {})
  }
})
