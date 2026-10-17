import { HTTPError } from 'nitro'

// Firestore documents are capped at 1 MiB, and every chat message is stored as its own document.
export const MAX_MESSAGE_BYTES = 900_000
export const MAX_ATTACHMENTS = 5
export const MAX_INPUT_CHARS = 20_000
/** Longer conversations are trimmed to their most recent messages before reaching the model. */
export const MAX_CONTEXT_MESSAGES = 100

/** Chat requires sign-in. Anonymous chat is an explicit opt-in (ALLOW_ANONYMOUS_CHAT=true), e.g. for local demos. */
export const allowAnonymousChat = () => process.env.ALLOW_ANONYMOUS_CHAT === 'true'

/** Size as stored: Firestore counts bytes, not UTF-16 code units. */
function sizeOf(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

export function assertMessageSizes(messages: unknown[]) {
  for (const m of messages) {
    if (sizeOf(m) > MAX_MESSAGE_BYTES) {
      throw new HTTPError({ statusCode: 413, statusMessage: 'A message (or its attachment) is too large. Use a smaller file.' })
    }
  }
}

/**
 * Keeps the most recent messages, starting at a user turn so tool calls are never orphaned.
 * Chats may grow without limit; only the context sent to the model is bounded.
 */
export function trimHistory<T extends { role: string }>(messages: T[]): T[] {
  if (messages.length <= MAX_CONTEXT_MESSAGES) return messages
  let start = messages.length - MAX_CONTEXT_MESSAGES
  while (start < messages.length - 1 && messages[start]!.role !== 'user') start++
  return messages.slice(start)
}

/**
 * Validates what a new chat will store as ONE message document: the text plus every attachment,
 * measured in bytes. Called before anything is written so nothing is left half-created.
 */
export function assertNewChatMessage(input: string, attachments: Array<{ url: string, name?: string, contentType?: string }> | undefined) {
  if (attachments) {
    if (attachments.length > MAX_ATTACHMENTS) {
      throw new HTTPError({ statusCode: 413, statusMessage: `Too many attachments (max ${MAX_ATTACHMENTS}).` })
    }
  }
  const parts = [
    ...(attachments ?? []).map(a => ({ type: 'file', mediaType: a.contentType, url: a.url, filename: a.name })),
    { type: 'text', text: input }
  ]
  if (sizeOf({ role: 'user', parts }) > MAX_MESSAGE_BYTES) {
    throw new HTTPError({ statusCode: 413, statusMessage: 'Attachments are too large. Use smaller files.' })
  }
}
