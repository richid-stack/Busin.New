/** One thing an app task did, in words the person can read. */
export interface ActionStep { label: string, status: 'running' | 'done' | 'failed', detail?: string }

const SMALL_WORDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'by', 'from', 'with'])

/** `GITHUB_CREATE_AN_ISSUE` -> "Create an issue". The app's own name is dropped from the front. */
export function actionLabel(slug: string, appName = ''): string {
  let words = slug.replace(/^mcp_/i, '').split(/[_\s-]+/).filter(Boolean).map(w => w.toLowerCase())
  const app = appName.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (words.length > 1 && app && (app.startsWith(words[0]!) || words[0] === app)) words = words.slice(1)
  const text = words.map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w)).join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A short, safe hint about what a step was given (a title, a name, a search), never a whole payload. */
export function stepDetail(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  for (const key of ['title', 'name', 'subject', 'query', 'q', 'path', 'channel', 'repo', 'file_name']) {
    const v = (input as Record<string, unknown>)[key]
    if (typeof v === 'string' && v.trim()) return v.replace(/\s+/g, ' ').trim().slice(0, 80)
  }
  return undefined
}

/** Reads the steps of a finished or running model loop: each tool call, and whether its result worked. */
export function stepsFrom(modelSteps: Array<{ toolCalls?: any[], toolResults?: any[], content?: any[] }>, appName: string, running = false): ActionStep[] {
  const out: ActionStep[] = []
  for (const step of modelSteps) {
    const failedIds = new Set((step.content ?? []).filter(p => p?.type === 'tool-error').map(p => p.toolCallId))
    const results = new Map((step.toolResults ?? []).map(r => [r.toolCallId, r.output ?? r.result]))
    for (const call of step.toolCalls ?? []) {
      const res: any = results.get(call.toolCallId)
      const failed = failedIds.has(call.toolCallId) || (res && typeof res === 'object' && (res.successful === false || (res.error && res.successful !== true)))
      const finished = results.has(call.toolCallId) || failedIds.has(call.toolCallId)
      out.push({
        label: actionLabel(call.toolName, appName),
        status: failed ? 'failed' : finished || !running ? 'done' : 'running',
        ...(stepDetail(call.input ?? call.args) ? { detail: stepDetail(call.input ?? call.args) } : {})
      })
    }
  }
  return out
}
