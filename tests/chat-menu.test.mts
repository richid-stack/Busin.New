import assert from 'node:assert/strict'
import { chatMenu, chatToMarkdown, exportFileName } from '../src/utils/chatMenu.ts'

const noop = () => {}
const h = { pin: noop, share: noop, rename: noop, moveTo: noop, removeFromWorkspace: noop, exportChat: noop, remove: noop }
const labels = (m: any[][]) => m.flat().map((i: any) => i.label)
const ws = [{ id: 'a', name: 'Kofi Bakery' }, { id: 'b', name: 'Shop sign' }]

// A chat in no workspace: can be added, cannot be removed.
let m = chatMenu({ id: '1' }, ws, h)
assert.deepEqual(labels(m), ['Pin', 'Share', 'Rename', 'Add to workspace', 'Export', 'Delete'])
assert.equal((m[0]!.find((i: any) => i.label === 'Add to workspace') as any).children.length, 2)

// A chat already in a workspace: never "Add", can move (to the others only) or leave.
m = chatMenu({ id: '1', workspaceId: 'a' }, ws, h)
assert.deepEqual(labels(m), ['Pin', 'Share', 'Rename', 'Move to workspace', 'Remove from workspace', 'Export', 'Delete'])
assert.deepEqual((m[0]!.find((i: any) => i.label === 'Move to workspace') as any).children.map((c: any) => c.label), ['Shop sign'])
assert.ok(!labels(m).includes('Add to workspace'))

// Only one workspace and the chat is in it: nothing to move to, but it can still leave.
m = chatMenu({ id: '1', workspaceId: 'a' }, [ws[0]!], h)
assert.deepEqual(labels(m), ['Pin', 'Share', 'Rename', 'Remove from workspace', 'Export', 'Delete'])

// No workspaces at all: no workspace item.
assert.deepEqual(labels(chatMenu({ id: '1' }, [], h)), ['Pin', 'Share', 'Rename', 'Export', 'Delete'])

// Pinned chats offer Unpin, and Delete is last and red.
m = chatMenu({ id: '1', pinned: true }, [], h)
assert.equal(labels(m)[0], 'Unpin')
assert.equal((m[1]![0] as any).color, 'error')

// Selecting calls the right handler.
const calls: string[] = []
m = chatMenu({ id: '1', workspaceId: 'a' }, ws, { ...h, pin: p => calls.push(`pin:${p}`), moveTo: id => calls.push(`move:${id}`), removeFromWorkspace: () => calls.push('leave') })
;(m[0]![0] as any).onSelect(); (m[0]!.find((i: any) => i.label === 'Move to workspace') as any).children[0].onSelect(); (m[0]!.find((i: any) => i.label === 'Remove from workspace') as any).onSelect()
assert.deepEqual(calls, ['pin:true', 'move:b', 'leave'])

// Markdown export: words only, in order.
const md = chatToMarkdown('Invoice help', [
  { role: 'user', parts: [{ type: 'text', text: 'Write reminders' }] },
  { role: 'assistant', parts: [{ type: 'tool-x' }, { type: 'text', text: 'Done.' }] },
  { role: 'assistant', parts: [{ type: 'tool-y' }] }
])
assert.equal(md, '# Invoice help\n\n**You**\n\nWrite reminders\n\n---\n\n**OpenLobs**\n\nDone.\n')
assert.equal(exportFileName('Reply to the supplier in Kumasi!'), 'Reply-to-the-supplier-in-Kumasi.md')
assert.equal(exportFileName('???'), 'chat.md')
console.log('chat-menu: all passed')
