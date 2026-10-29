/**
 * Small, dependency-free helpers for showing browser use: used by the server (to describe a step) and by the chat card
 * (to say what a numbered control is, and what the assistant is doing).
 */

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'this page' }
}

/** The words of control number `ref` in a result's control list, or null. The list is written by the server, one control per line. */
export function controlName(controls: string, ref: number): string | null {
  const m = new RegExp(`^\\[${ref}\\] \\S+ ("(?:[^"\\\\]|\\\\.)*")`, 'm').exec(controls)
  if (!m) return null
  try { return JSON.parse(m[1]!) } catch { return null }
}

export interface FlatStep { action?: string, url?: string | null, ref?: number | null, text?: string | null, key?: string | null, direction?: string | null, value?: string | null }

/** What a step does, in plain words. `controls` is the list from the page the step was written against. */
export function stepText(step: FlatStep, controls = ''): string {
  const named = step.ref ? controlName(controls, step.ref) : null
  const what = named ? `“${named.slice(0, 60)}”` : 'a control'
  switch (step.action) {
    case 'open': return `Opening ${hostOf(String(step.url ?? ''))}`
    case 'read': return 'Reading the page'
    case 'click': return `Clicking ${what}`
    case 'type': return `Typing into ${what}`
    case 'select': return `Choosing “${String(step.value ?? '').slice(0, 40)}” in ${what}`
    case 'press': return `Pressing ${step.key ?? 'a key'}`
    case 'scroll': return step.direction === 'up' ? 'Scrolling up' : 'Scrolling down'
    case 'back': return 'Going back'
    case 'wait': return 'Waiting for the page'
    default: return 'Using the browser'
  }
}
