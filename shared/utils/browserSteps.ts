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

/**
 * What a step is, in plain words, in the same voice as the other trace lines ("Searching the web...", "Searched the web").
 * `controls` is the list from the page the step was written against, so a number can be shown as the control's own words.
 */
export function stepText(step: FlatStep, controls = '', mode: 'doing' | 'done' | 'failed' = 'doing'): string {
  const named = step.ref ? controlName(controls, step.ref) : null
  const what = named ? `“${named.slice(0, 60)}”` : 'a control'
  const host = hostOf(String(step.url ?? ''))
  const value = String(step.value ?? '').slice(0, 40)
  const words: Record<string, [string, string, string]> = {
    open: [`Opening ${host}...`, `Opened ${host}`, `Could not open ${host}`],
    read: ['Reading the page...', 'Read the page', 'Could not read the page'],
    click: [`Clicking ${what}...`, `Clicked ${what}`, `Could not click ${what}`],
    type: [`Typing into ${what}...`, `Typed into ${what}`, `Could not type into ${what}`],
    select: [`Choosing “${value}” in ${what}...`, `Chose “${value}” in ${what}`, `Could not choose in ${what}`],
    press: [`Pressing ${step.key ?? 'a key'}...`, `Pressed ${step.key ?? 'a key'}`, `Could not press ${step.key ?? 'a key'}`],
    scroll: [step.direction === 'up' ? 'Scrolling up...' : 'Scrolling down...', step.direction === 'up' ? 'Scrolled up' : 'Scrolled down', 'Could not scroll'],
    back: ['Going back...', 'Went back', 'Could not go back'],
    wait: ['Waiting for the page...', 'Waited for the page', 'Could not wait for the page']
  }
  const row = words[step.action ?? ''] ?? ['Using the browser...', 'Used the browser', 'Could not use the browser']
  return row[mode === 'doing' ? 0 : mode === 'done' ? 1 : 2]
}
