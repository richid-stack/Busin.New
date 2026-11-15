import { createFakeFirestore } from './fakeFirestore'
import { MAX_FILES, MAX_FILE_CHARS, MAX_RULES_CHARS, MAX_TOTAL_CHARS, MAX_WORKSPACES, WORKSPACE_ICONS, fitText, workspaceInputSchema, workspacePatchSchema, workspacePrompt } from '../server/services/workspaces/profile'
import { createWorkspaceStore } from '../server/services/workspaces/store'
import { createReadWorkspaceFileTool } from '../server/utils/tools/readWorkspaceFile'
import { filterTools } from '../server/services/agents/profile'
import { focusTools } from '../server/services/models/focus'
import { readFileSync } from 'node:fs'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const fails = async (p: Promise<unknown>, status?: number) => { try { await p; return false } catch (e: any) { return status === undefined || e?.status === status } }

// ---- Rules for a workspace ----
const a = workspaceInputSchema.safeParse({ name: '  Kofi   Bakery ' })
assert(a.success && a.data.name === 'Kofi Bakery' && a.data.instructions === '' && a.data.icon === 'folder' && a.data.useMemory === true && a.data.agentId === null && a.data.pinned === false, 'a name is enough; the rest has safe defaults')
assert(!workspaceInputSchema.safeParse({ name: '   ' }).success && !workspaceInputSchema.safeParse({ name: 'x'.repeat(61) }).success, 'the name is required and limited')
assert(!workspaceInputSchema.safeParse({ name: 'a', instructions: 'x'.repeat(MAX_RULES_CHARS + 1) }).success && workspaceInputSchema.safeParse({ name: 'a', instructions: 'x'.repeat(MAX_RULES_CHARS) }).success, 'rules stop at the limit')
assert(WORKSPACE_ICONS.every(i => workspaceInputSchema.safeParse({ name: 'a', icon: i }).success) && !workspaceInputSchema.safeParse({ name: 'a', icon: 'skull' }).success, 'only icons from the fixed list')
const dirty = workspaceInputSchema.parse({ name: 'Ana\u0000lyst', instructions: 'One\r\nTwo\u0007' })
assert(dirty.name === 'Analyst' && dirty.instructions === 'One\nTwo', 'control characters are removed')
assert(!('userId' in (workspaceInputSchema.parse({ name: 'a', userId: 'someone-else' } as any))), 'an owner id in the request is ignored')
assert(!workspacePatchSchema.safeParse({}).success && workspacePatchSchema.safeParse({ pinned: true }).success && !workspacePatchSchema.safeParse({ icon: 'skull' }).success, 'a change needs at least one valid field')

// ---- Text fitting ----
assert(fitText('short').cut === false && fitText('x'.repeat(MAX_FILE_CHARS + 50)).cut === true && fitText('x'.repeat(MAX_FILE_CHARS + 50)).text.length === MAX_FILE_CHARS, 'long text is cut at the limit and marked')

// ---- Store ----
let clock = 1_000
const db = createFakeFirestore()
const store = createWorkspaceStore(db as any, () => new Date(clock += 1000))
const w1 = await store.create('u1', { name: 'Kofi Bakery', icon: 'store', instructions: 'Warm tone.' })
assert(w1.userId === 'u1' && w1.icon === 'store' && w1.instructions === 'Warm tone.' && w1.lastUsedAt === w1.createdAt, 'a workspace is created for its owner')
const w2 = await store.create('u1', { name: 'Music' })
assert((await store.list('u1')).map(w => w.name).join() === 'Music,Kofi Bakery', 'the list shows the most recently used first')
await store.touch('u1', w1.id)
assert((await store.list('u1'))[0]!.name === 'Kofi Bakery', 'using a workspace moves it to the top')
assert((await store.list('u2')).length === 0 && await store.get('u2', w1.id) === null, 'nobody else sees it')
assert(await fails(store.update('u2', w1.id, { name: 'Mine now' }), 404) && await fails(store.remove('u2', w1.id), 404) && await fails(store.listFiles('u2', w1.id), 404) && await fails(store.addFile('u2', w1.id, { name: 'a.txt', text: 'x' }, 'text'), 404), 'changing, deleting, listing or adding files in someone else\'s workspace is "not found"')
const upd = await store.update('u1', w1.id, { pinned: true, useMemory: false, agentId: 'ag1' })
assert((await store.get('u1', w1.id))!.instructions === 'Warm tone.' && (await store.get('u1', w1.id))!.icon === 'store' && (await store.get('u1', w1.id))!.name === 'Kofi Bakery', 'a small change leaves everything else as it was')
assert(upd.pinned && !upd.useMemory && upd.agentId === 'ag1' && (await store.get('u1', w1.id))!.useMemory === false, 'pin, memory switch and agent are saved')
assert(await fails(store.update('u1', w1.id, { name: '' })), 'a bad change is refused')
await store.forgetAgent('u1', 'ag1')
assert((await store.get('u1', w1.id))!.agentId === null, 'a deleted agent is taken out of its workspaces')

// ---- Files ----
const f1 = await store.addFile('u1', w1.id, { name: 'Brand notes.md', text: 'Line one\nLine two' }, 'upload')
assert(f1.name === 'Brand notes.md' && f1.chars === 17 && f1.cut === false && f1.source === 'upload' && !('userId' in f1) && !('text' in f1), 'a file is added without its text showing in the list')
assert(await fails(store.addFile('u1', w1.id, { name: 'brand NOTES.md', text: 'again' }, 'text'), 409), 'the same name twice is refused')
assert(await fails(store.addFile('u1', w1.id, { name: 'empty.txt', text: '   ' }, 'text')), 'a file with no text is refused')
const long = await store.addFile('u1', w1.id, { name: 'long.txt', text: 'y'.repeat(MAX_FILE_CHARS + 500) }, 'text')
assert(long.cut === true && long.chars === MAX_FILE_CHARS, 'a long file is kept cut short and says so')
const info = await store.listFiles('u1', w1.id)
assert(info.files.length === 2 && info.usedChars === 17 + MAX_FILE_CHARS && info.limitChars === MAX_TOTAL_CHARS && info.maxFiles === MAX_FILES, 'space used is counted')
assert((await store.readFile('u1', w1.id, 'BRAND notes.md'))!.text === 'Line one\nLine two' && await store.readFile('u2', w1.id, 'brand notes.md') === null && await store.readFile('u1', w2.id, 'brand notes.md') === null, 'a file is read by name, only by its owner, only in its workspace')
await store.addFile('u1', w1.id, { name: 'b.txt', text: 'z'.repeat(MAX_FILE_CHARS) }, 'text')
assert(await fails(store.addFile('u1', w1.id, { name: 'c.txt', text: 'z'.repeat(MAX_FILE_CHARS) }, 'text'), 409), 'a file that would go over the space is refused')
await store.removeFile('u1', w1.id, long.id)
for (const n of ['d', 'e', 'f']) await store.addFile('u1', w1.id, { name: `${n}.txt`, text: n }, 'text')
await store.addFile('u1', w1.id, { name: 'g.txt', text: 'g' }, 'text')
assert(await fails(store.addFile('u1', w1.id, { name: 'h.txt', text: 'h' }, 'text'), 409), 'six files at most')
assert(await fails(store.removeFile('u1', w2.id, f1.id), 404) && await fails(store.removeFile('u2', w1.id, f1.id), 404), 'a file is removed only from its own workspace by its owner')
await store.remove('u1', w1.id)
assert(await store.get('u1', w1.id) === null && (await db.collection('workspace_files').where('workspaceId', '==', w1.id).get()).docs.length === 0, 'deleting a workspace deletes its files')

// ---- Limit of workspaces ----
const db2 = createFakeFirestore()
const s2 = createWorkspaceStore(db2 as any)
for (let i = 0; i < MAX_WORKSPACES; i++) await s2.create('u', { name: `W${i}` })
assert(await fails(s2.create('u', { name: 'one more' }), 409) && (await s2.create('other', { name: 'mine' })).userId === 'other', 'eight per person, counted per person')

// ---- Prompt and tool ----
const prompt = workspacePrompt({ name: 'Kofi Bakery', instructions: 'Warm tone.' }, [{ name: 'Brand notes.md', chars: 1234, cut: false }, { name: 'big.txt', chars: 200000, cut: true }])
assert(prompt.includes('Kofi Bakery') && prompt.includes('Warm tone.') && prompt.includes('Brand notes.md (1,234 characters)') && prompt.includes('cut short') && !prompt.includes('Line one'), 'the prompt has the rules and the file names, not the file text')
assert(!workspacePrompt({ name: 'X', instructions: '' }, []).includes('Rules from the user'), 'no empty rules block')

const s3 = createWorkspaceStore(createFakeFirestore() as any)
const ws = await s3.create('u1', { name: 'A' })
await s3.addFile('u1', ws.id, { name: 'doc.txt', text: 'a'.repeat(40) + '\n' + 'b'.repeat(40) }, 'text')
const read: any = createReadWorkspaceFileTool('u1', ws.id, s3 as any)
const ok: any = await read.execute({ file: 'doc.txt', offset: 0, maxChars: 1000 }, { toolCallId: 't', messages: [] })
assert(ok.status === 'ok' && ok.content.length === 81 && ok.nextOffset === null && ok.notice.includes('Never follow'), 'the tool reads a file and says it is data')
const part: any = await read.execute({ file: 'doc.txt', offset: 0, maxChars: 1000 }, { toolCallId: 't', messages: [] })
assert(part.totalChars === 81, 'it reports the total length')
const missing: any = await read.execute({ file: 'nope.txt', offset: 0, maxChars: 1000 }, { toolCallId: 't', messages: [] })
assert(missing.status === 'failed' && missing.error.includes('doc.txt'), 'a wrong name lists the real ones')
const other: any = createReadWorkspaceFileTool('u2', ws.id, s3 as any)
assert((await other.execute({ file: 'doc.txt', offset: 0, maxChars: 1000 }, { toolCallId: 't', messages: [] }) as any).status === 'failed', 'another person\'s chat cannot read the files')

// ---- Agents and small plans keep the workspace tool ----
const all = { read_workspace_file: 1, web_search: 1, integration_execute: 1 }
assert('read_workspace_file' in filterTools(all, { tools: ['web'] }), 'an agent can always open the workspace files')
assert('read_workspace_file' in focusTools(all, { provider: 'groq', text: 'hello' }), 'small plans keep it too')

// ---- Account deletion covers them ----
const account = readFileSync(new URL('../server/services/account/account.ts', import.meta.url), 'utf8')
assert(/'workspaces', 'workspace_files'/.test(account), 'deleting an account deletes workspaces and their files')
