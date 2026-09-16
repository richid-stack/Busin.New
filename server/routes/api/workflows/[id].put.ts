import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { useUserSession } from '../../../utils/session'
import { getWorkflow, updateWorkflow, createWorkflow } from '../../../utils/firebase'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)
  const userId = session.data.user?.id || session.id!

  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)

  const body = await readValidatedBody(event, z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['active', 'draft', 'paused']).optional(),
    nodes: z.array(z.any()).optional(),
    edges: z.array(z.any()).optional(),
    nodeSchemas: z.record(z.string(), z.any()).optional()
  }).parse)

  let existing = await getWorkflow(id)
  if (!existing && (id === 'client-onboarding-pipeline' || id === 'default')) {
    existing = await createWorkflow({
      id,
      title: body.title || 'Client Onboarding Pipeline',
      description: body.description || 'Enterprise Client Onboarding Automation Pipeline',
      userId,
      nodes: body.nodes || [],
      edges: body.edges || [],
      nodeSchemas: body.nodeSchemas || {},
      status: body.status || 'active'
    })
    return {
      success: true,
      id,
      updatedAt: new Date().toISOString()
    }
  }

  if (!existing || (existing.userId !== userId && existing.userId !== 'system')) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found or access denied' })
  }

  await updateWorkflow(id, body)

  return {
    success: true,
    id,
    updatedAt: new Date().toISOString()
  }
})
