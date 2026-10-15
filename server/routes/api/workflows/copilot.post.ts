import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { generateObject } from 'ai'
import { requireUser } from '../../../utils/session'
import { getLanguageModel, pickAvailableModel } from '../../../utils/models'

const nodeSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(['trigger', 'agent', 'action', 'logic', 'approval']),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  data: z.record(z.string(), z.any())
}).passthrough()

const edgeSchema = z.object({
  id: z.string().min(1).max(200),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullish()
}).passthrough()

export default defineHandler(async (event) => {
  await requireUser(event)

  const body = await readValidatedBody(event, z.object({
    prompt: z.string().min(1).max(4000),
    nodes: z.array(nodeSchema).max(100),
    edges: z.array(edgeSchema).max(300)
  }).parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Invalid body' })
  })

  const modelId = pickAvailableModel()
  if (!modelId) {
    throw new HTTPError({ statusCode: 503, statusMessage: 'No AI provider is configured on the server.' })
  }

  const systemPrompt = `You are a Workflow Assistant. You modify a DAG (Directed Acyclic Graph) of workflow nodes based on user instructions.
Current Nodes: ${JSON.stringify(body.nodes, null, 2)}
Current Edges: ${JSON.stringify(body.edges, null, 2)}

Node types: 'trigger', 'action', 'agent', 'logic', 'approval'
Valid logic subtypes: 'if-else', 'switch', 'code'
If-else nodes have two outgoing handles: edges use sourceHandle "true" or "false".
Variables are written {{node-id.path}} (e.g. {{ai-triage.result}}).

The user will ask you to add, remove, or modify nodes and edges.
Return the COMPLETE updated nodes and edges arrays.
Position new nodes neatly relative to existing nodes (x, y coordinates).
Every edge must connect existing node ids and the graph must stay acyclic.`

  const result = await generateObject({
    model: getLanguageModel(modelId),
    schema: z.object({
      nodes: z.array(nodeSchema),
      edges: z.array(edgeSchema),
      summary: z.string().describe('A short summary of what you did')
    }),
    system: systemPrompt,
    prompt: body.prompt,
    abortSignal: AbortSignal.timeout(60_000)
  })

  // Never hand the editor a graph with dangling edges.
  const ids = new Set(result.object.nodes.map(n => n.id))
  const edges = result.object.edges.filter(e => ids.has(e.source) && ids.has(e.target))

  return {
    success: true,
    nodes: result.object.nodes,
    edges,
    summary: result.object.summary
  }
})
