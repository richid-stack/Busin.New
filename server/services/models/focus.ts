// Some free model plans only take a few thousand tokens a minute (Groq's free plan: about 7,000). A full chat
// here sends 15,000 to 20,000 once every tool is described, so those models would refuse every message.
// For them we describe only the tools the message is about. Everything else stays one sentence away:
// ask for it and the next message carries the right tools.

/** Providers whose free plans are too small for the full tool list. */
export const SMALL_WINDOW_PROVIDERS = ['groq'] as const

const ALWAYS = ['calculator', 'weather', 'web_search', 'web_fetch']

const TOPICS: Array<{ words: RegExp, tools: string[] }> = [
  { words: /\b(automat\w*|workflow\w*|pipeline\w*|whenever|every time|connect\w*|integrat\w*|gmail|slack|drive|sheets?|calendar|notion|trigger\w*|schedule\w*|zap\w*)\b/i, tools: ['workflow_create', 'workflow_run', 'integration_status', 'integration_execute'] },
  { words: /\b(word|docx|pdf|document|report|proposal|letter|contract|cv|resume|spreadsheet|excel|xlsx|slides?|deck|presentation|powerpoint|pptx|page|website|landing|html)\b/i, tools: ['create_document', 'create_spreadsheet', 'create_presentation', 'create_page', 'edit_file', 'read_document'] },
  { words: /\b(chart|graph|plot|diagram)\b/i, tools: ['chart'] },
  { words: /\b(plan|steps?|roadmap|checklist)\b/i, tools: ['plan'] },
  { words: /\b(remember|forget|memory|memories)\b/i, tools: ['remember', 'forget_memory'] },
  { words: /\b(skills?)\b/i, tools: ['load_skill', 'find_skill', 'load_external_skill'] },
  { words: /\b(font|icon|design|style|css|colou?rs?|brand)\b|https?:\/\//i, tools: ['look_at_page', 'design_tokens', 'find_icons', 'find_fonts', 'inspect_design'] },
  { words: /\b(github|repo|repository)\b/i, tools: ['github_read'] },
  { words: /\b(agent|assistant that|task)\b/i, tools: ['propose_agent', 'task_propose'] },
  { words: /\b(image|photo|picture|file|download)\b/i, tools: ['fetch_file', 'view_image'] }
]

export function focusTools<T extends Record<string, unknown>>(tools: T, input: { provider: string | null, text: string }): Partial<T> {
  if (!input.provider || !(SMALL_WINDOW_PROVIDERS as readonly string[]).includes(input.provider)) return tools
  const keep = new Set<string>(ALWAYS)
  for (const t of TOPICS) if (t.words.test(input.text)) for (const n of t.tools) keep.add(n)
  const out: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(tools)) if (keep.has(name)) out[name] = def
  return out as Partial<T>
}
