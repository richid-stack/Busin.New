/**
 * Handing a job to one of OpenLobs' specialists, inside the same chat.
 *
 * The lead assistant calls `hand_to_specialist`. From the next step the same model wears that specialist's hat: its
 * instructions are added and it is given only its own tools, until it calls `report_back`, which gives the job back
 * to the lead. Nothing is stored: who is working is worked out from the messages every step, so it also holds when
 * a reply stops for an approval and carries on afterwards. Approvals, traces, credits and streaming are the chat's own.
 *
 * Plain functions, no database, so it can be tested directly.
 */
import { SPECIALISTS, specialistById } from '../../../shared/specialists'
import type { Specialist } from '../../../shared/specialists'
import { TOOL_GROUPS } from '../agents/profile'

export const HAND_OFF_TOOL = 'hand_to_specialist'
export const REPORT_TOOL = 'report_back'
/** Steps a specialist may take before it is made to report back. */
export const SPECIALIST_MAX_STEPS = 6
/** Extra steps a reply may take when specialists are on offer, so handing over and reporting back do not eat the lead's own. */
export const HAND_OFF_EXTRA_STEPS = 8

/** Tools every specialist may use besides its own groups: they belong to the chat or workspace, not to a kind of work. */
const SHARED_TOOLS = ['load_skill', 'read_workspace_file', 'save_to_notes', 'update_where_we_are']

/** The tools a specialist may use, out of what this chat has. */
export function specialistToolNames(s: Pick<Specialist, 'groups'>, available: Iterable<string>): string[] {
  const have = new Set(available)
  const own = TOOL_GROUPS.filter(g => s.groups.includes(g.id)).flatMap(g => g.tools)
  return [...new Set([...own, ...SHARED_TOOLS])].filter(n => have.has(n))
}

/** Specialists that have at least one tool of their own here. A specialist with nothing to work with is not offered. */
export function offeredSpecialists(available: Iterable<string>): Specialist[] {
  const have = [...available]
  return SPECIALISTS.filter(s => {
    const own = new Set(TOOL_GROUPS.filter(g => s.groups.includes(g.id)).flatMap(g => g.tools))
    return have.some(n => own.has(n))
  })
}

export interface ActiveHandoff { specialist: Specialist, brief: string, steps: number }

// Model messages are read loosely on purpose: only the few fields below matter and providers add many more.
type Part = { type?: string, toolName?: string, toolCallId?: string, input?: any, output?: any }
type Message = { role?: string, content?: unknown }
const partsOf = (m: Message): Part[] => (Array.isArray(m.content) ? m.content as Part[] : [])
const statusOf = (output: any): string | undefined => output?.value?.status ?? output?.status

/**
 * Who is working right now, from the messages of this reply only (a handoff never carries over to the next question).
 * Null means the lead assistant. A specialist cannot hand over to another one, and a handoff whose result failed never started.
 */
export function activeHandoff(messages: Message[]): ActiveHandoff | null {
  let from = 0
  messages.forEach((m, i) => { if (m.role === 'user') from = i + 1 })
  let active: (ActiveHandoff & { callId: string, at: number }) | null = null
  for (let i = from; i < messages.length; i++) {
    const m = messages[i]!
    if (m.role === 'assistant') {
      if (active && i > active.at) active.steps++
      for (const p of partsOf(m)) {
        if (p.type !== 'tool-call') continue
        if (p.toolName === REPORT_TOOL) active = null
        else if (p.toolName === HAND_OFF_TOOL && !active) {
          const specialist = specialistById(p.input?.specialist)
          if (specialist) active = { specialist, brief: String(p.input?.brief ?? '').slice(0, 1500), steps: 0, callId: String(p.toolCallId ?? ''), at: i }
        }
      }
    } else if (m.role === 'tool' && active) {
      const open: { callId: string } = active
      for (const p of partsOf(m)) {
        if (p.type === 'tool-result' && p.toolCallId === open.callId && statusOf(p.output) !== 'handed') active = null
      }
    }
  }
  return active ? { specialist: active.specialist, brief: active.brief, steps: active.steps } : null
}

/** What the model is told while it is a specialist. */
export function specialistPrompt(h: ActiveHandoff, toolNames: string[]): string {
  const s = h.specialist
  return `**YOU ARE NOW ${s.name.toUpperCase()}, OPENLOBS' ${s.role.toUpperCase()}.**
The lead assistant handed you one job. Do that job, nothing else. The rules above still apply.
- ${s.instructions}
- Your tools: ${toolNames.filter(n => n !== REPORT_TOOL).join(', ') || 'none'}. If the job needs another tool, say so in your report. Never pretend to have used a tool.
- You cannot hand the job to anyone else. Keep any text you write short: the lead answers the person.
- When you are done, or cannot go on, call report_back once. Say what you found or did, what you could not do, and anything the person must decide. Quote facts and numbers exactly.

Brief from the lead:
${h.brief}`
}

type Instructions = string | { role?: string, content?: unknown } | Array<{ role?: string, content?: unknown }> | undefined

/** Adds a block after the instructions the chat already has, whatever shape they are in (text, or a cached message). */
export function appendInstructions(base: Instructions, extra: string): Instructions {
  if (base === undefined) return extra
  if (typeof base === 'string') return `${base}\n\n${extra}`
  const add = { role: 'system', content: extra }
  return Array.isArray(base) ? [...base, add] : [base, add]
}

export interface StepPlan { activeTools: string[], toolChoice?: { type: 'tool', toolName: string }, instructions: Instructions }

/**
 * What the next step may use. `instructions` must be the chat's own, from before any step changed them (`initialInstructions`). The lead keeps everything except `report_back`. A specialist gets only its own tools,
 * plus `report_back`, and once it has used its steps it can only report back.
 */
export function planStep(input: { messages: Message[], toolNames: string[], instructions: Instructions }): StepPlan {
  const h = activeHandoff(input.messages)
  // The lead gets the chat's own instructions back every time: an override from an earlier step carries forward unless it is replaced.
  if (!h) return { activeTools: input.toolNames.filter(n => n !== REPORT_TOOL), instructions: input.instructions }
  const own = specialistToolNames(h.specialist, input.toolNames)
  if (h.steps >= SPECIALIST_MAX_STEPS) {
    return {
      activeTools: [REPORT_TOOL],
      toolChoice: { type: 'tool', toolName: REPORT_TOOL },
      instructions: appendInstructions(input.instructions, `${specialistPrompt(h, [REPORT_TOOL])}\n\nYou are out of steps. Call report_back now with what you have, and say what is left undone.`)
    }
  }
  return { activeTools: [...own, REPORT_TOOL], instructions: appendInstructions(input.instructions, specialistPrompt(h, own)) }
}

/** What the lead is told about specialists. Only the ones that have tools here are named. */
export function leadPrompt(offered: Specialist[]): string {
  const list = offered.map(s => `  * ${s.name} (${s.role}): ${s.when}`).join('\n')
  return `**SPECIALISTS:**
- OpenLobs has built-in specialists you can hand a job to with hand_to_specialist. They work in this same chat and report back to you.
${list}
- Hand over only a job that clearly fits one and needs several steps. Do not hand over a plain question, or something you can do with one or two tool calls yourself.
- Before you hand over, say in one short sentence who you are asking and why. Write the brief so the specialist needs nothing else: the goal, what the person said, what to return.
- When a report comes back, answer the person yourself. Say who did the work. Never claim a specialist did something its report does not say.
${offered.some(s => s.id === 'tortoise') ? '- After a big job with many steps (research plus a finished file, a build, many changes), hand the result to Tortoise, the Checker, before you give your final answer. For a quick answer, only do that if the person asks.\n' : ''}`
}
