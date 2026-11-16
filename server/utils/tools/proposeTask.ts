import { tool } from 'ai'
import { z } from 'zod'
import { CRITERION_KINDS, DEFAULT_TASK_GROUPS, FILE_FORMATS, taskInputSchema } from '../../services/tasks/model'
import { describeEstimate, estimateTaskCredits } from '../../services/tasks/estimate'
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
    })).max(8).describe('How the user will know it worked. Two to four is usual.'),
    alsoUse: z.array(z.enum(['study_sites', 'save_files', 'read_code'])).max(3).optional().describe('Extra abilities, only when the job needs them. study_sites: look at live web pages, read the colours and fonts a site uses, find free icons and fonts. save_files: download a file or image from a web address to keep. read_code: read public code on GitHub and what people have shared in the Reef. Leave out for plain research.'),
    useBrowser: z.boolean().optional().describe('True only when the job needs a real website operated (filling a form, a booking flow, a portal with no API). The task will pause and ask the user before it sends, buys or deletes anything, and whenever a page needs them to sign in. Leave out for reading and research.')
  }),
  execute: withToolLimits(
    { name: 'task_propose', userId, perMinute: 5, timeoutMs: 5_000, maxResultChars: 8_000 },
    async (input) => {
      const { useBrowser, alsoUse, ...rest } = input
      const extra = [...(useBrowser ? ['browser'] : []), ...(alsoUse ?? [])]
      const parsed = taskInputSchema.safeParse({ ...rest, ...(extra.length ? { tools: [...DEFAULT_TASK_GROUPS, ...extra] } : {}) })
      if (!parsed.success) return { status: 'failed' as const, error: `${parsed.error.issues[0]?.message ?? 'The draft is not valid.'} Fix the draft and try again.` }
      const estimate = estimateTaskCredits({ criteria: parsed.data.criteria, model: parsed.data.model, maxAttempts: parsed.data.maxAttempts })
      return {
        status: 'proposed' as const,
        draft: { goal: parsed.data.goal, criteria: parsed.data.criteria, ...(extra.length ? { tools: parsed.data.tools } : {}) },
        estimate: { ...estimate, text: describeEstimate(estimate) },
        note: 'The user sees a card with a Start button and what it will cost in credits. Nothing runs until they press it. Say in one sentence what you drafted. Do not claim it has started.'
      }
    }
  )
})
