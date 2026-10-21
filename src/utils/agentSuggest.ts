/**
 * Free, local guess at which of a person's saved agents suits what they are typing. No model is
 * involved: it compares words. It only speaks up when the match is clear, and never picks for them.
 */
export interface SuggestableAgent { id: string, name: string, description: string, instructions: string }

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'are', 'can', 'will', 'have', 'has', 'was', 'what', 'when', 'where', 'which', 'who', 'how', 'why',
  'please', 'could', 'would', 'should', 'about', 'into', 'some', 'any', 'all', 'out', 'new', 'make', 'give', 'help', 'need', 'want', 'like', 'just', 'get', 'use', 'using',
  'them', 'then', 'than', 'they', 'their', 'there', 'here', 'also', 'more', 'most', 'been', 'being', 'does', 'did', 'its', 'our', 'ours', 'agent', 'always', 'never', 'every'
])

const stem = (word: string) => word.replace(/(ing|ed|es|s)$/, '')

export function keywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
      .filter(w => w.length >= 4 && !STOP.has(w))
      .map(stem)
      .filter(w => w.length >= 3)
  )
}

export interface AgentSuggestion { agent: SuggestableAgent, matched: string[] }

/** The one agent that clearly fits the prompt, or null. A match needs 2+ shared words, one from the agent's name or description. */
export function suggestAgent(prompt: string, agents: SuggestableAgent[]): AgentSuggestion | null {
  const wanted = keywords(prompt)
  if (wanted.size < 2) return null

  const scored = agents.map((agent) => {
    const head = keywords(`${agent.name} ${agent.description}`)
    const body = keywords(agent.instructions)
    const matched = [...wanted].filter(w => head.has(w) || body.has(w))
    const inHead = matched.filter(w => head.has(w)).length
    return { agent, matched, score: inHead * 2 + (matched.length - inHead), inHead }
  }).filter(s => s.matched.length >= 2 && s.inHead >= 1).sort((a, b) => b.score - a.score)

  const [best, next] = scored
  if (!best || (next && next.score >= best.score)) return null
  return { agent: best.agent, matched: best.matched }
}
