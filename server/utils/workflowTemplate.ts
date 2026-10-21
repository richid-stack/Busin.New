// Placeholders ({{node.path}}) and bounded snapshots of a run. Kept apart from the engine so node
// implementations can use them without importing the engine.

// Replaces {{node-id.path.to.value}} placeholders using the run context.
// Unknown paths are left visible as [path] so mistakes are easy to spot in logs.
export function interpolateVariables(template: string, context: Record<string, any>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, path: string) => {
    const parts = path.split('.')
    let current: any = context
    for (const part of parts) {
      if (current && typeof current === 'object' && Object.hasOwn(current, part)) {
        current = current[part]
      } else {
        return `[${path}]`
      }
    }
    return typeof current === 'string' ? current : JSON.stringify(current)
  })
}

// Interpolates every string inside arbitrarily nested config values.
export function interpolateDeep<T>(value: T, context: Record<string, any>): T {
  if (typeof value === 'string') return interpolateVariables(value, context) as unknown as T
  if (Array.isArray(value)) return value.map(v => interpolateDeep(v, context)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value as Record<string, any>)) out[k] = interpolateDeep(v, context)
    return out as T
  }
  return value
}

const MAX_CONTEXT_CHARS = 30_000

// JSON-safe, acyclic, size-capped copy of the run context (safe for prompts and persistence).
export function snapshotContext(context: unknown, maxChars = MAX_CONTEXT_CHARS): any {
  try {
    const json = JSON.stringify(context ?? null)
    if (json.length <= maxChars) return JSON.parse(json)
    return { truncated: true, preview: json.slice(0, maxChars) }
  } catch {
    return { unserialisable: true }
  }
}

/**
 * Like snapshotContext for a `{ nodeId: output }` map, but oversized outputs are cut one node at a
 * time, so every node keeps its key and the `{{nodeId.path}}` shape that later steps rely on
 * instead of the whole context collapsing into one opaque preview.
 */
export function snapshotOutputs(outputs: Record<string, unknown> | undefined, maxChars = MAX_CONTEXT_CHARS): Record<string, any> {
  const whole = snapshotContext(outputs ?? {}, maxChars)
  if (!whole || !(whole as any).truncated) return whole
  const entries = Object.entries(outputs ?? {})
  const perNode = Math.max(500, Math.floor(maxChars / Math.max(entries.length, 1)))
  const result: Record<string, any> = {}
  for (const [key, value] of entries) {
    result[key] = snapshotContext(value, perNode)
  }
  return result
}

export const stripBraces = (expr: string) => expr.replace(/\{\{\s*/g, '').replace(/\s*\}\}/g, '')
