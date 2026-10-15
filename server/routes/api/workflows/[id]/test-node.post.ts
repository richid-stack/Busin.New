import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { executeSingleNode } from '../../../../utils/workflowEngine'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const userId = user.id

  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)

  const body = await readValidatedBody(event, z.object({
    node: z.any(),
    inputs: z.record(z.string(), z.any()).optional()
  }).parse).catch(() => { throw new HTTPError({ statusCode: 400, statusMessage: 'Invalid body' }) })

  if (!body.node) {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Node definition is required' })
  }

  const runResult = await executeSingleNode(body.node, body.inputs || {}, userId)

  return {
    success: true,
    result: runResult
  }
})
