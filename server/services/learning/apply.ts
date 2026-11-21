import { MemoryError } from '../memory/memory'
import { addMemory, deleteMemory, getMemory, updateMemory } from '../memory/store'
import { agentInputSchema } from '../agents/profile'
import { getAgent, updateAgent } from '../agents/store'
import { addInstructionLine, lineId, removeInstructionLine } from './learning'

type Fail = { ok: false, status: number, error: string }
const fail = (status: number, error: string): Fail => ({ ok: false, status, error })
const asFail = (err: unknown): Fail => {
  if (err instanceof MemoryError) return fail(400, err.message)
  throw err
}

export interface SaveInput { kind: 'memory' | 'agent', text: string, replaces?: string, agentId?: string }
export type SaveResult = { ok: true, value: { id: string, existed?: boolean, previous?: string } } | Fail

/** Keeps a suggestion the person accepted. The same rules as the Memory page and the agent editor apply. */
export async function saveLearning(userId: string, input: SaveInput): Promise<SaveResult> {
  try {
    if (input.kind === 'memory') {
      if (input.replaces) {
        const old = await getMemory(input.replaces)
        if (!old || old.userId !== userId) return fail(404, 'The memory to replace was not found.')
        await updateMemory(userId, old.id, input.text)
        return { ok: true, value: { id: old.id, previous: old.text } }
      }
      const { item, existed } = await addMemory(userId, input.text, 'assistant')
      return { ok: true, value: { id: item.id, existed } }
    }
    if (!input.agentId) return fail(400, 'Which agent?')
    const agent = await getAgent(input.agentId)
    if (!agent || agent.userId !== userId) return fail(404, 'Agent not found.')
    const added = addInstructionLine(agent.instructions, input.text)
    if (added === null) return { ok: true, value: { id: lineId(input.text), existed: true } }
    if ('error' in added) return fail(400, added.error)
    await updateAgent(agent.id, agentInputSchema.parse({ ...agent, instructions: added.instructions }))
    return { ok: true, value: { id: lineId(input.text) } }
  } catch (err) { return asFail(err) }
}

export interface UndoInput { kind: 'memory' | 'agent', agentId?: string, text?: string, restore?: string }

/** Takes it back: deletes the memory, puts the old words back, or removes the line from the agent. */
export async function undoLearning(userId: string, id: string, input: UndoInput): Promise<{ ok: true } | Fail> {
  try {
    if (input.kind === 'memory') {
      const mem = await getMemory(id)
      if (!mem || mem.userId !== userId) return fail(404, 'Memory not found.')
      if (input.restore) await updateMemory(userId, id, input.restore)
      else await deleteMemory(id)
      return { ok: true }
    }
    if (!input.agentId || !input.text) return fail(400, 'Which agent and which line?')
    const agent = await getAgent(input.agentId)
    if (!agent || agent.userId !== userId) return fail(404, 'Agent not found.')
    if (lineId(input.text) !== id) return fail(400, 'That is not the line that was added.')
    const instructions = removeInstructionLine(agent.instructions, input.text)
    if (instructions && instructions !== agent.instructions) await updateAgent(agent.id, agentInputSchema.parse({ ...agent, instructions }))
    return { ok: true }
  } catch (err) { return asFail(err) }
}
