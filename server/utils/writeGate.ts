/**
 * Which tools only look, and which can change things. Used when a person has not been asked first:
 * a tool counts as read-only only when its name says so and nothing in it says otherwise. Anything
 * unclear counts as a change, which costs one extra question and never a surprise.
 */

const READ_VERBS = new Set(['GET', 'LIST', 'SEARCH', 'FIND', 'FETCH', 'READ', 'RETRIEVE', 'VIEW', 'QUERY', 'LOOKUP', 'CHECK', 'COUNT', 'DESCRIBE', 'SHOW', 'BROWSE'])

const CHANGE_WORDS = new Set([
  'CREATE', 'UPDATE', 'DELETE', 'REMOVE', 'SEND', 'POST', 'ADD', 'EDIT', 'PATCH', 'PUT', 'UPLOAD', 'WRITE', 'SET', 'MOVE', 'RENAME',
  'REPLY', 'FORWARD', 'INVITE', 'ARCHIVE', 'CLOSE', 'REOPEN', 'MERGE', 'PUBLISH', 'TRASH', 'CANCEL', 'APPROVE', 'ASSIGN', 'FORK', 'STAR',
  'UNSTAR', 'TRANSFER', 'REVOKE', 'GRANT', 'DISABLE', 'ENABLE', 'RUN', 'EXECUTE', 'TRIGGER', 'START', 'STOP', 'LOCK', 'UNLOCK', 'CLEAR',
  'RESET', 'SUBMIT', 'SCHEDULE', 'DUPLICATE', 'IMPORT', 'SYNC', 'PAY', 'CHARGE', 'REFUND', 'SUBSCRIBE', 'UNSUBSCRIBE', 'SHARE', 'ASK'
])

/** `GITHUB_LIST_ISSUES` and `mcp_github_get_file` look; `GMAIL_SEND_EMAIL` does not. */
export function looksReadOnly(toolName: string): boolean {
  const words = toolName.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  if (!words.some((w, i) => i < 4 && READ_VERBS.has(w))) return false
  return !words.some(w => CHANGE_WORDS.has(w))
}

/** Keeps only the tools that look. */
export function onlyReadTools<T extends Record<string, unknown>>(tools: T, isRead: (name: string) => boolean = looksReadOnly): Partial<T> {
  return Object.fromEntries(Object.entries(tools).filter(([name]) => isRead(name))) as Partial<T>
}

export type Access = 'read' | 'change'
