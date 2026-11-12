// Anthropic charges a tenth of the price for the part of a request it has seen a moment ago. A chat re-sends the
// same instructions, tool descriptions and history on every step, so marking where that part ends makes long
// replies (a build with many steps) much cheaper. Other providers cache on their own, or not at all: nothing changes.
import type { ModelMessage, SystemModelMessage } from 'ai'

const MARK = { anthropic: { cacheControl: { type: 'ephemeral' as const } } }

/** Marks the end of the instructions and the end of the conversation so far as cache points (Anthropic only). */
export function withPromptCache(provider: string | null, system: string, messages: ModelMessage[]): { system: string | SystemModelMessage, messages: ModelMessage[] } {
  if (provider !== 'anthropic') return { system, messages }
  const marked = messages.map((m, i) => i === messages.length - 1
    ? { ...m, providerOptions: { ...m.providerOptions, anthropic: { ...m.providerOptions?.anthropic, ...MARK.anthropic } } } as ModelMessage
    : m)
  return { system: { role: 'system', content: system, providerOptions: MARK }, messages: marked }
}
