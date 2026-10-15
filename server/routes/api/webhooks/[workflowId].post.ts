import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readBody, getQuery } from 'nitro/h3'
import { z } from 'zod'
import { getWorkflow } from '../../../utils/firebase'
import crypto from 'node:crypto'
import { getHeader } from 'nitro/h3'
import { executeAndRecordRun } from '../../../utils/workflowRuns'

export default defineHandler(async (event) => {
  const { workflowId } = await getValidatedRouterParams(event, z.object({
    workflowId: z.string()
  }).parse)

  let body = {}
  try {
    body = await readBody(event) || {}
  } catch (e) {
    // If not JSON, ignore
  }

  const query = getQuery(event)

  const workflow = await getWorkflow(workflowId)

  if (!workflow) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  // The endpoint is public, so every call must present the workflow's secret
  // (`x-webhook-secret` header or `?secret=`). Compared in constant time.
  const provided = getHeader(event, 'x-webhook-secret') || (typeof query.secret === 'string' ? query.secret : '')
  const expected = workflow.webhookSecret || ''
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HTTPError({ statusCode: 401, statusMessage: 'Invalid or missing webhook secret' })
  }

  if (workflow.status !== 'active') {
    throw new HTTPError({ statusCode: 409, statusMessage: `Workflow is ${workflow.status} and cannot be triggered` })
  }

  // Never persist the secret into run inputs/logs
  const safeHeaders = Object.fromEntries(event.headers.entries())
  delete safeHeaders['x-webhook-secret']
  const { secret: _secret, ...safeQuery } = query as Record<string, unknown>

  const payload = {
    method: event.method,
    headers: safeHeaders,
    query: safeQuery,
    body
  }

  // Find trigger node (by provider webhook, subtype webhook, or generic trigger)
  const triggerNode = workflow.nodes?.find(n =>
    n.type === 'trigger' && (n.data?.provider === 'webhook' || n.data?.subtype === 'webhook')
  ) || workflow.nodes?.find(n => n.type === 'trigger')

  const inputMap: Record<string, any> = {}
  if (triggerNode) {
    inputMap[triggerNode.id] = payload
  }
  inputMap['webhook'] = payload
  inputMap['trigger'] = payload

  const { run, result } = await executeAndRecordRun(workflow, inputMap, workflow.userId)

  return {
    success: result.status !== 'failed',
    runId: run.id,
    status: result.status,
    approvalRequired: result.status === 'waiting_approval',
    durationMs: result.durationMs
  }
})
