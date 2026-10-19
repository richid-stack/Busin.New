import { tool } from 'ai'
import { z } from 'zod'
import { PROPOSABLE_GROUPS, makeProposal } from '../../services/agents/proposal'
import { withToolLimits } from './limits'

/** Shows the person a draft agent they can save. It never saves anything itself. */
export const createProposeAgentTool = (userId: string) => tool({
  description: `Offer the user a saved agent they can create with one click. Use it only when they ask for an agent, or describe a job they will do again and again and an agent would clearly help. Never for a one-off question. It saves nothing: the user reviews the draft and decides. Tool groups you may include: ${PROPOSABLE_GROUPS.join(', ')}.`,
  inputSchema: z.object({
    name: z.string().min(1).max(60).describe('Short name, for example "Weekly report writer"'),
    description: z.string().max(200).describe('One line on what it is for'),
    instructions: z.string().min(1).max(4000).describe('Clear instructions the agent will follow every time, written to the agent in the second person'),
    tools: z.array(z.string()).max(8).describe('Tool groups the agent needs. Leave out anything it does not need.'),
    maxSteps: z.number().int().min(1).max(15).optional()
  }),
  execute: withToolLimits(
    { name: 'propose_agent', userId, perMinute: 5, timeoutMs: 5_000, maxResultChars: 8_000 },
    async (input) => {
      const result = makeProposal(input)
      if (!result.ok) return { status: 'failed' as const, error: `${result.error} Fix the draft and try again.` }
      return {
        status: 'proposed' as const,
        draft: result.proposal.draft,
        dropped: result.proposal.dropped,
        note: 'The user sees this as a card with a Save button. Nothing is saved until they click it. Tell them in one sentence what you drafted. Do not claim it is saved.'
      }
    }
  )
})
