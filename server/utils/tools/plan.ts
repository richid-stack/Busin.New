import type { UIToolInvocation } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'

export type PlanUIToolInvocation = UIToolInvocation<typeof planTool>

export const planTool = tool({
  description: 'Outline an execution plan with structured steps for complex tasks, multi-step research, or workflow coordination.',
  inputSchema: z.object({
    title: z.string().describe('Short title for the task or plan'),
    steps: z.array(z.object({
      task: z.string().describe('Description of the step'),
      status: z.enum(['pending', 'in_progress', 'completed']).default('completed').describe('Current status of the step')
    })).min(1).describe('The sequence of steps to accomplish the goal'),
    summary: z.string().optional().describe('Optional synthesis or next action note')
  }),
  execute: async ({ title, steps, summary }) => {
    return {
      title,
      steps,
      summary
    }
  }
})
