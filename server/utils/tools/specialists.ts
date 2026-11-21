import { tool } from 'ai'
import { z } from 'zod'
import { specialistById } from '../../../shared/specialists'
import type { Specialist } from '../../../shared/specialists'
import { HAND_OFF_TOOL, activeHandoff } from '../../services/specialists/handoff'
import { withToolLimits } from './limits'

/**
 * The lead assistant hands one job to a specialist. This tool only starts the handoff: the chat route then gives the
 * next steps the specialist's instructions and tools (see services/specialists/handoff).
 */
export const createHandToSpecialistTool = (userId: string, offered: Specialist[]) => tool({
  description: `Hand one job to a built-in OpenLobs specialist. They work in this chat with their own tools and report back. Specialists: ${offered.map(s => `${s.id} (${s.role}): ${s.when}`).join(' | ')}`,
  inputSchema: z.object({
    specialist: z.enum(offered.map(s => s.id) as [string, ...string[]]).describe('Which specialist'),
    brief: z.string().min(10).max(1500).describe('The whole job in a few sentences: the goal, what the person asked for, and what to return. The specialist sees the chat too.')
  }),
  execute: withToolLimits(
    { name: HAND_OFF_TOOL, userId, perMinute: 12, timeoutMs: 5_000, maxResultChars: 1_000 },
    async ({ specialist }) => {
      const s = specialistById(specialist)
      if (!s || !offered.some(o => o.id === s.id)) return { status: 'failed' as const, error: 'That specialist is not available here. Do the job yourself or say what is missing.' }
      return { status: 'handed' as const, specialist: s.id, name: s.name, role: s.role }
    }
  )
})

/** The specialist gives the job back. It must be working for the lead; anything else is refused. */
export const createReportBackTool = () => tool({
  description: 'Give the job back to the lead assistant with your report. Call it once when you are done or cannot go on.',
  inputSchema: z.object({
    summary: z.string().min(2).max(3000).describe('What you found or did, what you could not do, and anything the person must decide. Exact facts and numbers.')
  }),
  execute: async ({ summary }, options) => {
    const h = activeHandoff((options?.messages ?? []) as any)
    if (!h) return { status: 'failed' as const, error: 'No specialist job is open, so there is nothing to report back.' }
    return { status: 'reported' as const, specialist: h.specialist.id, name: h.specialist.name, summary }
  }
})
