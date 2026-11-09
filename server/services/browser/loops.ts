import { createHash } from 'node:crypto'
import { describeAction, type BrowserAction, type PageState } from './model'

/**
 * Notices when the assistant is going in circles: the same step on the same page again and again, or two or three
 * steps that undo each other. A loop burns the step budget and gets nowhere, so the third try is refused with words
 * the assistant can act on (what it keeps doing, what went wrong last time, what to do instead).
 */

const WINDOW = 12

/** What the page looked like when the step was decided: where it is, what it says and what is filled in. */
export function pageKey(state: PageState | null): string {
  if (!state) return ''
  const parts = [
    state.url, state.title, Math.round(state.scroll.y / 50),
    state.elements.map(e => `${e.name}:${e.value ?? ''}:${e.checked ?? ''}:${e.disabled ? 1 : 0}`).join(','),
    state.text.slice(0, 600)
  ]
  return createHash('sha1').update(parts.join('\u0001')).digest('hex').slice(0, 16)
}

export function actionKey(action: BrowserAction): string {
  return JSON.stringify(action, Object.keys(action).sort())
}

export class LoopGuard {
  private history: string[] = []
  /** Why an attempt failed, by its key, so the next refusal can say it. */
  private why = new Map<string, string>()

  /** Null when the step is fine; otherwise what to tell the assistant. Does not record anything. */
  check(action: BrowserAction, state: PageState | null): string | null {
    const key = this.keyOf(action, state)
    const h = this.history
    const times = h.filter(k => k === key).length
    const twice = h.length >= 3 && key === h[h.length - 2] && h[h.length - 1] === h[h.length - 3] && key !== h[h.length - 1]
    const thrice = h.length >= 5 && key === h[h.length - 3] && h[h.length - 1] === h[h.length - 4] && h[h.length - 2] === h[h.length - 5] && new Set([key, h[h.length - 1], h[h.length - 2]]).size === 3
    if (times < 2 && !twice && !thrice) return null
    const what = describeAction(action, state).toLowerCase()
    const reason = this.why.get(key)
    return [
      times >= 2
        ? `You have already tried this ${times} times on this page and nothing changed (${what}).`
        : 'You are repeating the same few steps in a circle and the page is not changing.',
      reason ? `Last time it failed: ${reason}` : '',
      'Do not try it again. Read the page and choose a different way, or tell the person you are stuck and what you need from them.'
    ].filter(Boolean).join(' ')
  }

  record(action: BrowserAction, state: PageState | null) {
    this.history.push(this.keyOf(action, state))
    if (this.history.length > WINDOW) this.history.shift()
  }

  /** Remember why the latest attempt failed, in a few words. */
  failed(action: BrowserAction, state: PageState | null, message: string) {
    const key = this.keyOf(action, state)
    this.why.set(key, message.replace(/\s+/g, ' ').slice(0, 160))
    if (this.why.size > WINDOW * 2) this.why.delete(this.why.keys().next().value as string)
  }

  private keyOf(action: BrowserAction, state: PageState | null) { return `${actionKey(action)}@${pageKey(state)}` }
}
