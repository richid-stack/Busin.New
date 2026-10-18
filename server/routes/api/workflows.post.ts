import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../utils/session'
import { createWorkflow, isReservedWorkflowId, resolveWorkflowId } from '../../utils/firebase'
import { scheduleFieldsForSave } from '../../utils/workflowSchedule'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const userId = user.id

  const body = await readValidatedBody(event, z.object({
    id: z.string().regex(/^[\w-]{1,128}$/).optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(['active', 'draft', 'paused']).optional().default('active'),
    nodes: z.array(z.any()).default([]),
    edges: z.array(z.any()).default([])
  }).parse)

  const requestedId = body.id ? resolveWorkflowId(userId, body.id) : undefined
  if (requestedId && isReservedWorkflowId(userId, requestedId)) {
    throw new HTTPError({ statusCode: 400, statusMessage: 'This workflow id is reserved.' })
  }

  const schedule = await scheduleFieldsForSave(userId, requestedId, null, { status: body.status, nodes: body.nodes })

  let workflow
  try {
    workflow = await createWorkflow({
    id: requestedId,
    title: body.title,
    description: body.description,
    status: body.status,
    nodes: body.nodes,
    edges: body.edges,
    userId,
    scheduleNextRunAt: schedule?.scheduleNextRunAt ?? null
    })
  } catch (err: any) {
    // Firestore ALREADY_EXISTS (gRPC code 6)
    if (err?.code === 6 || /already exists/i.test(err?.message || '')) {
      throw new HTTPError({ statusCode: 409, statusMessage: 'A workflow with this id already exists' })
    }
    throw err
  }

  if (!workflow) {
    throw new HTTPError({ statusCode: 500, statusMessage: 'Failed to create workflow' })
  }

  return workflow
})
