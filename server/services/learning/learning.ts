/**
 * Learning from corrections, as suggestions. When the person corrects the assistant or states a lasting preference, the
 * assistant may offer one short line to keep. It is shown word for word with the person's own message as evidence, and
 * nothing is saved until they press the button (see POST /api/learning). Plain functions so they can be tested directly.
 */
import { createHash } from 'node:crypto'
import { MemoryError, cleanMemoryText, groundedInCorrection, sameMemory } from '../memory/memory'
import type { MemoryItem } from '../memory/memory'
import { MAX_INSTRUCTIONS_CHARS } from '../agents/profile'

/** Suggestions one chat may make. Few on purpose: a suggestion that turns up every message is noise. */
export const MAX_PROPOSALS_PER_CHAT = 3

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

export type LearningKind = 'memory' | 'agent'

export interface LearningInput {
  kind: LearningKind
  text: string
  /** The person's own words that led to this, copied from their latest message. */
  evidence: string
  replacesId?: string
  /** The person's latest message. Only what they wrote counts: never a page, file or tool result. */
  userText: string
  memories: Pick<MemoryItem, 'id' | 'text'>[]
  /** Texts already suggested in this chat. */
  before: string[]
  /** For an agent: the lines it already has in its instructions. */
  instructions?: string
}

export type LearningResult =
  | { ok: true, text: string, evidence: string, replaces?: { id: string, text: string } }
  | { ok: false, error: string }

/** Checks a suggestion the model made. The model is not trusted: it must quote the person and say what they said. */
export function checkProposal(input: LearningInput): LearningResult {
  if (input.before.length >= MAX_PROPOSALS_PER_CHAT) return { ok: false, error: 'Enough suggestions in this chat already. Do not suggest more unless the person asks.' }
  let text: string
  try { text = cleanMemoryText(input.text) } catch (err) {
    return { ok: false, error: err instanceof MemoryError ? err.message : 'That cannot be kept.' }
  }
  const evidence = input.evidence.replace(/\s+/g, ' ').trim()
  const said = normalize(input.userText)
  if (evidence.length < 3 || evidence.length > 240 || !said.includes(normalize(evidence))) {
    return { ok: false, error: 'The evidence must be copied from the person\'s own latest message. Suggest nothing unless they said it.' }
  }
  if (!groundedInCorrection(input.userText, text)) {
    return { ok: false, error: 'That is not what the person said. Suggest only what they said, in their words.' }
  }
  if (input.before.some(b => sameMemory(b, text))) return { ok: false, error: 'You already suggested that in this chat.' }
  if (input.kind === 'memory') {
    if (input.memories.some(m => sameMemory(m.text, text))) return { ok: false, error: 'That is already in memory.' }
    if (input.replacesId) {
      const old = input.memories.find(m => m.id === input.replacesId)
      if (!old) return { ok: false, error: 'The memory you want to replace does not exist.' }
      return { ok: true, text, evidence, replaces: { id: old.id, text: old.text } }
    }
  } else if (input.instructions !== undefined && instructionLines(input.instructions).some(l => sameMemory(l, text))) {
    return { ok: false, error: 'This agent already has that in its instructions.' }
  }
  return { ok: true, text, evidence }
}

/** Every suggested text in a chat so far, read from the saved messages. */
export function proposedIn(messages: Array<{ parts?: any[] }>): string[] {
  return messages.flatMap(m => (m.parts ?? [])
    .filter(p => p?.type === 'tool-propose_learning' && p.output?.status === 'proposed')
    .map(p => String(p.output.text ?? '')))
}

const instructionLines = (instructions: string) => instructions.split('\n').map(l => l.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean)

/** A short id for a line added to an agent, so it can be taken back. */
export const lineId = (text: string) => createHash('sha1').update(normalize(text)).digest('hex').slice(0, 12)

/** Adds the line to the end of the agent's instructions as one bullet. Null when it is already there. */
export function addInstructionLine(instructions: string, rawText: string): { instructions: string } | { error: string } | null {
  const text = cleanMemoryText(rawText)
  if (instructionLines(instructions).some(l => sameMemory(l, text))) return null
  const next = `${instructions.trimEnd()}\n- ${text}`
  if (next.length > MAX_INSTRUCTIONS_CHARS) return { error: `This agent\'s instructions are full (${MAX_INSTRUCTIONS_CHARS} characters). Shorten them first.` }
  return { instructions: next }
}

/** Takes the line back out. Only the exact bullet that was added goes. */
export function removeInstructionLine(instructions: string, rawText: string): string {
  const text = normalize(rawText)
  const lines = instructions.split('\n')
  let at = -1
  lines.forEach((l, i) => { if (/^\s*-\s/.test(l) && normalize(l.replace(/^\s*-\s*/, '')) === text) at = i })
  if (at < 0) return instructions
  lines.splice(at, 1)
  return lines.join('\n').trimEnd()
}
