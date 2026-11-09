/**
 * What Lobby says while a job runs. The assistant narrates in its own words (the voice instructions ask it to), and this
 * turns the growing message into lines worth saying, one at a time, never twice:
 *
 *  - every complete sentence of what the assistant writes, as it arrives;
 *  - a short phrase for an action it started without saying anything first, so the room is never silent;
 *  - the question for a decision that needs a yes or a no.
 *
 * Pure functions over the message parts, so they are tested on their own and the page only has to speak what comes out.
 */
import { spokenText, takeSentences } from '../../shared/utils/spoken'

/** The most one piece of writing is read out. Long answers are for the screen; Lobby says so. */
export const LINE_CAP = 400
export const REST_ON_SCREEN = 'The rest is on your screen.'

type Part = { type: string, text?: string, state?: string, input?: any, approval?: { id: string }, toolName?: string }
type Message = { id: string, role: string, parts: Part[] }

export interface LobbyPart {
  key: string
  kind: 'text' | 'tool' | 'approval'
  /** The written text, for text parts. */
  text: string
  /** The text part has finished arriving. */
  done: boolean
  /** The phrase to say if nothing was said before this action. */
  phrase: string
  /** Whether the part just before this one in the same message was something the assistant wrote. */
  afterText: boolean
  /** Whether what was written just before asked a question. */
  askedBefore: boolean
  approvalId?: string
}

const SPELLING: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', onedrive: 'OneDrive', one_drive: 'OneDrive', hubspot: 'HubSpot', paystack: 'Paystack', google_drive: 'Google Drive', google_calendar: 'Google Calendar', gmail: 'Gmail' }
const words = (s: string) => s.replace(/[_-]+/g, ' ').trim()
const provider = (input: any) => {
  const slug = String(input?.provider || '').toLowerCase().trim().replace(/[- ]/g, '_')
  return slug ? (SPELLING[slug] ?? words(slug).replace(/\b\w/g, c => c.toUpperCase())) : 'one of your apps'
}

const isTool = (p: Part) => p.type === 'dynamic-tool' || p.type.startsWith('tool-')
export const toolNameOf = (p: Part) => (p.type === 'dynamic-tool' ? String(p.toolName || 'tool') : p.type.slice(5))

/** A few words for an action the assistant started without announcing. */
export function phraseFor(part: Part): string {
  const name = toolNameOf(part)
  if (name === 'web_search' || name === 'google_search') return 'Searching the web.'
  if (name === 'web_fetch') return 'Reading a page.'
  if (name === 'read_document') return 'Reading the file.'
  if (name === 'plan') return 'Making a plan.'
  if (name === 'calculator') return 'Doing the maths.'
  if (name === 'chart') return 'Drawing a chart.'
  if (name === 'weather') return 'Checking the weather.'
  if (name === 'remember' || name === 'forget_memory') return 'Updating my notes about you.'
  if (name.startsWith('create_')) return `Making ${words(name.slice(7))}.`
  if (name === 'integration_execute') return `Working in ${provider(part.input)}.`
  if (name.startsWith('mcp_')) return `Using ${words(name.slice(4))}.`
  return `Working on ${words(name)}.`
}

/** The question put to the person when an action needs their OK. */
export function approvalQuestion(part: Part): string {
  const name = toolNameOf(part)
  if (name === 'integration_execute') {
    const what = spokenText(String(part.input?.instruction || '')).slice(0, 160)
    return `I'm about to work in ${provider(part.input)}${what ? `: ${what.replace(/[.!?]+$/, '')}` : ''}. Shall I go ahead?`
  }
  const label = name.startsWith('mcp_') ? name.slice(4) : name
  return `I'd like to run ${words(label)}. Shall I go ahead?`
}

/** The pieces of the answer being given right now: everything after the person's last message. */
export function lobbyParts(messages: Message[]): LobbyPart[] {
  let from = messages.length
  while (from > 0 && messages[from - 1]!.role !== 'user') from--
  const out: LobbyPart[] = []
  for (const message of messages.slice(from)) {
    if (message.role !== 'assistant') continue
    message.parts.forEach((part, i) => {
      const key = `${message.id}:${i}`
      const before = message.parts[i - 1]
      const afterText = Boolean(before && before.type === 'text' && spokenText(before.text || ''))
      const askedBefore = afterText && (before!.text || '').trim().endsWith('?')
      if (part.type === 'text') {
        out.push({ key, kind: 'text', text: part.text || '', done: part.state !== 'streaming', phrase: '', afterText: false, askedBefore: false })
      } else if (isTool(part)) {
        if (part.state === 'approval-requested') out.push({ key, kind: 'approval', text: '', done: true, phrase: approvalQuestion(part), afterText, askedBefore, approvalId: part.approval?.id })
        else if (part.state === 'input-streaming' || part.state === 'input-available' || part.state === 'approval-responded') out.push({ key, kind: 'tool', text: '', done: false, phrase: phraseFor(part), afterText, askedBefore })
      }
    })
  }
  return out
}

/** What has already been said, per part. Kept by the page for as long as Lobby is open. */
export interface FeedState {
  /** How far into each text part has been looked at. */
  pos: Record<string, number>
  /** How many characters of each text part were said. */
  spoken: Record<string, number>
  /** Parts whose phrase or question was already said. */
  said: Record<string, true>
}
export const newFeedState = (): FeedState => ({ pos: {}, spoken: {}, said: {} })

/**
 * The lines to say now, given the parts and what was already said. `finished` is true once the answer has stopped
 * arriving, so the last unfinished sentence is said too.
 */
export function newLines(parts: LobbyPart[], state: FeedState, finished: boolean): string[] {
  const lines: string[] = []
  for (const part of parts) {
    if (part.kind === 'text') {
      const { sentences, next } = takeSentences(part.text, state.pos[part.key] ?? 0, part.done || finished)
      state.pos[part.key] = next
      for (const sentence of sentences) {
        const so_far = state.spoken[part.key] ?? 0
        if (so_far >= LINE_CAP) {
          if (!state.said[`${part.key}:cap`]) { state.said[`${part.key}:cap`] = true; lines.push(REST_ON_SCREEN) }
          continue
        }
        state.spoken[part.key] = so_far + sentence.length
        lines.push(sentence)
      }
    } else {
      // Said once, and only when the assistant did not already announce it (or ask the question) in words.
      // An action that first runs and then asks for approval is the same part twice: the question has its own mark.
      const mark = part.kind === 'approval' ? `${part.key}:ask` : part.key
      if (state.said[mark]) continue
      state.said[mark] = true
      if (part.kind === 'approval' ? !part.askedBefore : !part.afterText) lines.push(part.phrase)
    }
  }
  return lines
}

/** Marks everything in the messages so far as said, so opening Lobby on an old chat does not read it all out. */
export function primeFeed(parts: LobbyPart[], state: FeedState) {
  newLines(parts, state, true)
}
