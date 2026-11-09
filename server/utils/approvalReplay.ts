import type { UIMessage } from 'ai'

/**
 * An approval answers one question once. The signature on it proves the server asked, but it stays valid forever,
 * so a browser (or something running in it) could post the same chat again with the finished result taken out and the
 * approved action would run a second time. The server's own copy of the chat knows which tool calls already have
 * a result: an approval for one of those is a replay.
 */
const toolParts = (messages: UIMessage[]) =>
  messages.flatMap(m => (Array.isArray(m.parts) ? m.parts : []))
    .filter((p: any) => p && typeof p === 'object' && typeof p.toolCallId === 'string' && typeof p.state === 'string'
      && typeof p.type === 'string' && (p.type.startsWith('tool-') || p.type === 'dynamic-tool')) as unknown as Array<{ toolCallId: string, state: string }>

export function replayedApprovals(stored: UIMessage[], incoming: UIMessage[]): string[] {
  const finished = new Set(toolParts(stored).filter(p => p.state.startsWith('output-')).map(p => p.toolCallId))
  return [...new Set(toolParts(incoming).filter(p => p.state === 'approval-responded' && finished.has(p.toolCallId)).map(p => p.toolCallId))]
}
