import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { useUserSession } from '../../../utils/session'
import { getWorkflow, updateWorkflow } from '../../../utils/firebase'

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
    edges: z.array(z.any()).optional()
  }).parse)

  const existing = await getWorkflow(id)
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
