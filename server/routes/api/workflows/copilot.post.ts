import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { useUserSession } from '../../../utils/session'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)
  
  const body = await readValidatedBody(event, z.object({
    prompt: z.string(),
    nodes: z.array(z.any()),
    edges: z.array(z.any())
  }).parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Invalid body' })
  })

  // We ask Gemini to generate modifications to the nodes and edges based on the prompt.
  // We'll just ask it to return the entire new nodes and edges arrays for simplicity,
  // or just the diff. Returning full arrays is easier to apply.

  const systemPrompt = `You are a Workflow Assistant. You modify a DAG (Directed Acyclic Graph) of workflow nodes based on user instructions.
Current Nodes: ${JSON.stringify(body.nodes, null, 2)}
Current Edges: ${JSON.stringify(body.edges, null, 2)}

Node types: 'trigger', 'action', 'agent', 'logic', 'approval'
Valid logic subtypes: 'if-else', 'switch', 'code'

The user will ask you to add, remove, or modify nodes and edges.
Return the COMPLETE updated nodes and edges arrays.
Position new nodes neatly relative to existing nodes (x, y coordinates).`

  const result = await generateObject({
    model: google('gemini-3.5-flash'),
    schema: z.object({
      nodes: z.array(z.any()),
      edges: z.array(z.any()),
      summary: z.string().describe('A short summary of what you did')
    }),
    system: systemPrompt,
    prompt: body.prompt
  })

  return {
    success: true,
    nodes: result.object.nodes,
    edges: result.object.edges,
    summary: result.object.summary
  }
})
