import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { useUserSession } from '../../utils/session'
import { createWorkflow } from '../../utils/firebase'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)
  const userId = session.data.user?.id || session.id!

  const body = await readValidatedBody(event, z.object({
    id: z.string().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(['active', 'draft', 'paused']).optional().default('active'),
    nodes: z.array(z.any()).default([]),
    edges: z.array(z.any()).default([])
  }).parse)

  const workflow = await createWorkflow({
    id: body.id,
    title: body.title,
    description: body.description,
    status: body.status,
    nodes: body.nodes,
    edges: body.edges,
    userId
  })

  if (!workflow) {
    throw new HTTPError({ statusCode: 500, statusMessage: 'Failed to create workflow' })
  }

  return workflow
})
