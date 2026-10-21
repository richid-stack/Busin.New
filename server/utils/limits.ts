import { HTTPError } from 'nitro'

// Firestore documents are capped at 1 MiB, and every chat message is stored as its own document.
export const MAX_MESSAGE_BYTES = 900_000
export const MAX_ATTACHMENTS = 5
export const MAX_INPUT_CHARS = 20_000
export const MAX_MESSAGES_PER_REQUEST = 200

export const allowAnonymousChat = () => process.env.ALLOW_ANONYMOUS_CHAT !== 'false'

function sizeOf(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

export function assertMessageSizes(messages: unknown[]) {
  if (messages.length > MAX_MESSAGES_PER_REQUEST) {
    throw new HTTPError({ statusCode: 413, statusMessage: `Too many messages in one request (max ${MAX_MESSAGES_PER_REQUEST}).` })
  }
  for (const m of messages) {
    if (sizeOf(m) > MAX_MESSAGE_BYTES) {
      throw new HTTPError({ statusCode: 413, statusMessage: 'A message (or its attachment) is too large. Use a smaller file.' })
    }
  }
}

export function assertAttachments(attachments: Array<{ url: string, name?: string }> | undefined) {
  if (!attachments) return
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new HTTPError({ statusCode: 413, statusMessage: `Too many attachments (max ${MAX_ATTACHMENTS}).` })
  }
  if (sizeOf(attachments) > MAX_MESSAGE_BYTES) {
    throw new HTTPError({ statusCode: 413, statusMessage: 'Attachments are too large. Use smaller files.' })
  }
}
