import type { UIMessage } from 'ai'
import { replayedApprovals } from '../server/utils/approvalReplay'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const msg = (id: string, parts: any[]) => ({ id, role: 'assistant', parts }) as UIMessage
const tool = (toolCallId: string, state: string) => ({ type: 'tool-integration_execute', toolCallId, state, input: {} })

const asked = [msg('a', [tool('t1', 'approval-requested')])]
const answered = [msg('a', [tool('t1', 'approval-responded')])]
assert(replayedApprovals(asked, answered).length === 0, 'the first answer to a question is fine')

const done = [msg('a', [tool('t1', 'output-available')])]
assert(replayedApprovals(done, answered).join() === 't1', 'answering a question that already has its result is a replay')
assert(replayedApprovals([msg('a', [tool('t1', 'output-error')])], answered).join() === 't1', 'a failed run counts as used too')
assert(replayedApprovals([msg('a', [tool('t1', 'output-denied')])], answered).join() === 't1', 'a refused one counts as answered')
assert(replayedApprovals(done, done).length === 0, 'sending the finished result back is not an approval')
assert(replayedApprovals([msg('a', [tool('t2', 'output-available')])], answered).length === 0, 'a different tool call is not affected')
assert(replayedApprovals([msg('a', [{ type: 'text', text: 'hi' }])], [msg('b', [{ type: 'text', text: 'x' }, null as any])]).length === 0, 'text and odd parts are ignored')
assert(replayedApprovals([{ id: 'x', role: 'user' } as any], answered).length === 0, 'a message with no parts does not break it')
const dyn = { type: 'dynamic-tool', toolName: 'mcp_x', toolCallId: 'm1', state: 'output-available', input: {} }
assert(replayedApprovals([msg('a', [dyn])], [msg('a', [{ ...dyn, state: 'approval-responded' }])]).join() === 'm1', 'tools from connected servers are covered too')
console.log(process.exitCode ? 'Approval replay tests FAILED' : 'Approval replay tests OK')
