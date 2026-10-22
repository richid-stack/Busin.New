import { tool } from 'ai'
import { z } from 'zod'
import { CRITERION_KINDS, FILE_FORMATS, taskInputSchema } from '../../services/tasks/model'
import { withToolLimits } from './limits'

/** Shows the person a draft task they can start with one click. It starts nothing itself: tasks spend credits in the background. */
export const createProposeTaskTool = (userId: string) => tool({
  description: 'Offer the user a background task: a bigger job that takes minutes (research with a finished file, several steps, checking results) and that you cannot finish in this chat. Use it when they ask for that, or the job is clearly too long for a chat reply. Never for a quick question. It starts nothing: the user reviews the draft and presses Start. Write criteria the way a person would check the work: a file that must exist, a page that must look right, or a plain statement of what the result must contain.',
  inputSchema: z.object({
    goal: z.string().min(10).max(2000).describe('What to get done, written clearly enough for someone working alone'),
    criteria: z.array(z.object({
      text: z.string().min(3).max(300),
      kind: z.enum(CRITERION_KINDS).describe('file: a file must exist. visual: a web page must look right (needs url). check: judged by AI from what the tools did. manual: only the user can check it.'),
      format: z.enum(FILE_FORMATS).optional().describe('For file criteria: docx, pdf, xlsx or pptx'),
      url: z.string().max(2000).optional().describe('For visual criteria: the public web address')
    })).max(8).describe('How the user will know it worked. Two to four is usual.')
  }),
  execute: withToolLimits(
    { name: 'task_propose', userId, perMinute: 5, timeoutMs: 5_000, maxResultChars: 8_000 },
    async (input) => {
      const parsed = taskInputSchema.safeParse(input)
      if (!parsed.success) return { status: 'failed' as const, error: `${parsed.error.issues[0]?.message ?? 'The draft is not valid.'} Fix the draft and try again.` }
      return {
        status: 'proposed' as const,
        draft: { goal: parsed.data.goal, criteria: parsed.data.criteria },
        note: 'The user sees a card with a Start button. Nothing runs until they press it. Say in one sentence what you drafted and that it uses credits when it runs. Do not claim it has started.'
      }
    }
  )
})
