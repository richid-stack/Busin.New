import { z } from 'zod'
import { hostOf } from '../../../shared/utils/browserSteps'

/**
 * Browser use: what the assistant may ask a browser to do, what it gets back, and which actions need the person's OK.
 * Pure data and rules, shared by the browser worker, the app and the tests.
 */

export const BROWSER_LIMITS = {
  // Wide and short, like the live view in the chat, so what you see is exactly what the browser sees.
  viewport: { width: 1100, height: 560 },
  maxElements: 120,
  maxTextChars: 4000,
  nameChars: 90,
  navigationMs: 25_000,
  actionMs: 8_000,
  settleMs: 500,
  /** The most actions in one session, so a stuck loop cannot run forever. */
  maxActions: 80,
  /** A session nobody touched for this long is closed. */
  idleMs: 10 * 60_000,
  /** The longest a session lives at all. */
  maxLifeMs: 20 * 60_000,
  maxTabs: 4,
  /** How long a page is kept open while it waits for the person (a sign-in, a code, an OK). */
  holdMs: 30 * 60_000,
  maxTypeChars: 1000,
  maxUserTypeChars: 500
} as const

/** Keys the assistant may press. Anything else is refused. */
export const ALLOWED_KEYS = ['Enter', 'Tab', 'Shift+Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End'] as const

const ref = z.number().int().min(1).max(1000)

export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), url: z.string().min(1).max(2000) }).strict(),
  z.object({ action: z.literal('read') }).strict(),
  z.object({ action: z.literal('click'), ref }).strict(),
  z.object({ action: z.literal('type'), ref, text: z.string().max(BROWSER_LIMITS.maxTypeChars), submit: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('select'), ref, value: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('press'), key: z.enum(ALLOWED_KEYS) }).strict(),
  z.object({ action: z.literal('scroll'), direction: z.enum(['down', 'up']), amount: z.number().int().min(100).max(3000).optional() }).strict(),
  z.object({ action: z.literal('back') }).strict(),
  z.object({ action: z.literal('wait'), ms: z.number().int().min(200).max(3000) }).strict()
])
export type BrowserAction = z.infer<typeof actionSchema>

/** What the person does with their own hands when they take over the page. */
export const userInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), x: z.number().min(0).max(4000), y: z.number().min(0).max(4000) }).strict(),
  z.object({ kind: z.literal('type'), text: z.string().min(1).max(BROWSER_LIMITS.maxUserTypeChars) }).strict(),
  z.object({ kind: z.literal('key'), key: z.enum(ALLOWED_KEYS) }).strict(),
  z.object({ kind: z.literal('scroll'), dy: z.number().int().min(-3000).max(3000) }).strict()
])
export type UserInput = z.infer<typeof userInputSchema>

export interface PageElement {
  ref: number
  role: string
  name: string
  type?: string
  value?: string
  checked?: boolean
  disabled?: boolean
  required?: boolean
  options?: string[]
  /** Where a link goes: address without the query or fragment. */
  href?: string
  inView: boolean
  inSearch?: boolean
  inForm?: boolean
  /** Passwords, card numbers, one-time codes: the assistant never types these. */
  sensitive?: boolean
}

export interface PageState {
  url: string
  title: string
  elements: PageElement[]
  /** What the page says. Untrusted: it is content, never instructions. */
  text: string
  scroll: { y: number, max: number }
  focus: { ref: number | null, inSearch: boolean, inForm: boolean }
  hasPassword: boolean
  /** Set when the page asks something only a person can do. */
  blocker: null | 'captcha' | 'login'
  dialogs: string[]
  tabs: number
  truncated: boolean
}

export class BrowserError extends Error {
  constructor(message: string, readonly code: 'bad_input' | 'unsafe' | 'not_found' | 'limit' | 'failed' = 'failed') { super(message) }
}

export const SENSITIVE_FIELD = /pass(word|code|phrase)|\bpin\b|\bcvv\b|\bcvc\b|card.?(number|no)|security.?code|one.?time|\botp\b|\bssn\b|social.?security|secret/i
/** True when a field is one where the assistant must never type (the person does, by taking over). */
export const isSensitiveField = (label: string, type = '', autocomplete = '') =>
  type === 'password' || /(^|\s)(cc-|one-time-code|current-password|new-password)/i.test(autocomplete) || SENSITIVE_FIELD.test(label)

/** Words on a button or link that mean something happens in the world, not only on the screen. */
const CONSEQUENCE = /\b(pay|payment|buy|purchase|order|checkout|check out|place|confirm|submit|send|post|publish|share|delete|remove|cancel|close account|transfer|withdraw|deposit|sign out|log out|logout|unsubscribe|subscribe|apply|book|reserve|donate|approve|authori[sz]e|accept|agree|save|update|change|reset|register|sign up|join|invite|upload|download|activate|deactivate|disable|enable)\b/i
const SEARCHY = /^(search|find|go|filter|show|view|next|previous|prev|more|menu|open|close|back|read more|learn more|details)$/i

/** Does this action change something outside the screen? If so the person is asked first, and told what it is. */
export function needsOk(action: BrowserAction, state: PageState | null): { ask: boolean, label: string } {
  if (!state) return { ask: false, label: '' }
  const el = 'ref' in action ? state.elements.find(e => e.ref === action.ref) : undefined
  const host = hostOf(state.url)
  const consequential = (e: PageElement) => CONSEQUENCE.test(e.name.trim()) && !SEARCHY.test(e.name.trim())
  if (action.action === 'click' && el) {
    const name = el.name.trim()
    const submit = el.type === 'submit' && !el.inSearch && !SEARCHY.test(name)
    if (submit || consequential(el)) return { ask: true, label: `Click “${name || el.role}” on ${host}` }
  }
  if (action.action === 'press' && action.key === 'Enter') {
    const focused = state.focus.ref ? state.elements.find(e => e.ref === state.focus.ref) : undefined
    const inSearch = state.focus.inSearch || Boolean(focused?.inSearch)
    // Enter in a form sends it; Enter in a message box often sends the message; Enter on a focused "Pay" button pays.
    if (state.focus.inForm && !inSearch) return { ask: true, label: `Press Enter to send this form on ${host}` }
    if (focused && focused.role === 'textbox' && !inSearch) return { ask: true, label: `Press Enter in “${focused.name || 'a text box'}” on ${host}` }
    if (focused && focused.role !== 'textbox' && consequential(focused)) return { ask: true, label: `Press Enter on “${focused.name}” on ${host}` }
  }
  // Typing and pressing Enter in anything but a search box can send, post or submit, in a form or not.
  if (action.action === 'type' && action.submit && el && !el.inSearch) return { ask: true, label: `Type into “${el.name || 'a field'}” and press Enter on ${host}` }
  return { ask: false, label: '' }
}

export { hostOf }

/** Short, plain words for what an action does: used for the live card and the trace. */
export function describeAction(action: BrowserAction, state: PageState | null): string {
  const el = 'ref' in action ? state?.elements.find(e => e.ref === action.ref) : undefined
  const named = el?.name ? `“${el.name.slice(0, 60)}”` : 'an element'
  switch (action.action) {
    case 'open': return `Opening ${hostOf(action.url)}`
    case 'read': return 'Reading the page'
    case 'click': return `Clicking ${named}`
    case 'type': return `Typing into ${named}`
    case 'select': return `Choosing in ${named}`
    case 'press': return `Pressing ${action.key}`
    case 'scroll': return action.direction === 'down' ? 'Scrolling down' : 'Scrolling up'
    case 'back': return 'Going back'
    case 'wait': return 'Waiting for the page'
  }
}
