import { controlName, hostOf, stepText } from '../../shared/utils/browserSteps'

/**
 * Helpers for showing browser steps in the chat. A step's input says "click control 3"; what control 3 is lives in the
 * result of the step before it, so these look back through the reply to find it.
 */
type Part = any

const outputOf = (p: Part | undefined) => (p?.output && typeof p.output === 'object' ? p.output as Record<string, any> : null)

/** The control list the step at `index` was written against: the most recent earlier result that has one. */
export function controlsBefore(parts: Part[], index: number): string {
  for (let j = index - 1; j >= 0; j--) { const c = outputOf(parts[j])?.controls; if (typeof c === 'string') return c }
  return ''
}

/** The site the page was last on, for naming where a step happens. */
export function hostBefore(parts: Part[], index: number): string {
  for (let j = index; j >= 0; j--) { const u = outputOf(parts[j])?.url ?? (parts[j]?.input?.action === 'open' ? parts[j]?.input?.url : undefined); if (typeof u === 'string') return hostOf(u) }
  return ''
}

/** What the approval card says will happen: the step in the control's own words, and where. */
export function approvalInstruction(parts: Part[], part: Part): string {
  const i = parts.indexOf(part)
  const what = stepText(part.input ?? {}, controlsBefore(parts, Math.max(0, i)), 'doing').replace(/\.\.\.$/, '')
  const host = hostBefore(parts, Math.max(0, i))
  return host ? `${what} on ${host}` : what
}

export { controlName, stepText }
