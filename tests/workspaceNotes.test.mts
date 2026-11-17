import { createFakeFirestore } from './fakeFirestore'
import { MAX_NOTES, MAX_NOTE_CHARS, MAX_WHERE_CHARS, notesPrompt, workspacePatchSchema, workspacePrompt } from '../server/services/workspaces/profile'
import { createWorkspaceStore } from '../server/services/workspaces/store'
import { createSaveToNotesTool, createUpdateWhereWeAreTool } from '../server/utils/tools/workspaceNotes'
import { filterTools } from '../server/services/agents/profile'
import { focusTools } from '../server/services/models/focus'
import { DEFAULT_POWERS, POWERS, applyPowers, combinePowers, powerOf } from '../shared/powers'
import { readFileSync } from 'node:fs'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const fails = async (p: Promise<unknown>, status?: number) => { try { await p; return false } catch (e: any) { return status === undefined || e?.status === status } }

let clock = 1_000
const db = createFakeFirestore()
const store = createWorkspaceStore(db as any, () => new Date(clock += 1000))
const w = await store.create('u1', { name: 'Kofi logo' })
const other = await store.create('u1', { name: 'Music' })

// ---- Powers: the notes switch and the workspace's own switches ----
assert(POWERS.includes('notes' as any) && DEFAULT_POWERS.notes === true, 'notes is a power and starts on')
assert(powerOf('save_to_notes') === 'notes' && powerOf('update_where_we_are') === 'notes', 'both note tools belong to the notes power')
assert(JSON.stringify(w.powers) === JSON.stringify(DEFAULT_POWERS) && w.whereWeAre === null, 'a new workspace has every power on and no summary')
assert(Object.keys(applyPowers({ save_to_notes: 1, update_where_we_are: 2, chart: 3 }, { notes: false })).join() === 'chart', 'notes off removes both note tools and nothing else')
assert(combinePowers({ web: false }, { cloud: false }).web === false && combinePowers({ web: false }, { cloud: false }).cloud === false && combinePowers({ web: false }, { cloud: false }).apps === true, 'a power is on only when Settings and the workspace both have it on')
assert(combinePowers({ web: false }, { web: true }).web === false, 'a workspace cannot turn on what Settings turned off')
assert(combinePowers(undefined, undefined).notes === true && combinePowers('junk' as any, 42 as any).web === true, 'missing or damaged values leave everything on')

const up = await store.update('u1', w.id, { powers: { cloud: false } })
assert(up.powers.cloud === false && up.powers.web === true, 'switching one power off in a workspace changes only that one')
const up2 = await store.update('u1', w.id, { powers: { notes: false } })
assert(up2.powers.cloud === false && up2.powers.notes === false, 'a later change keeps the earlier one')
assert((await store.get('u1', w.id))!.powers.cloud === false && (await store.get('u1', other.id))!.powers.cloud === true, 'it is kept, and only for that workspace')
await store.update('u1', w.id, { powers: { cloud: true, notes: true } })
assert((await store.get('u1', w.id))!.powers.cloud === true, 'a power can be switched back on')
assert(!workspacePatchSchema.safeParse({ powers: { nonsense: true } }).success && !workspacePatchSchema.safeParse({ powers: { web: 'no' } }).success && workspacePatchSchema.safeParse({ powers: {} }).success === true, 'unknown powers and non-boolean values are refused')

// ---- Notes ----
const first = await store.addNote('u1', w.id, { text: '  Kofi picked   option 2.  ' }, 'you')
assert(first.status === 'saved' && first.note.text === 'Kofi picked option 2.' && first.note.by === 'you', 'a note is saved on one line, with who wrote it')
const dup = await store.addNote('u1', w.id, { text: 'kofi picked option 2.' }, 'assistant')
assert(dup.status === 'exists' && dup.note.id === first.note.id && (await store.listNotes('u1', w.id)).notes.length === 1, 'the same sentence twice is kept once')
await store.addNote('u1', w.id, { text: 'No red anywhere.' }, 'assistant')
const listed = await store.listNotes('u1', w.id)
assert(listed.notes.map(n => n.text).join('|') === 'Kofi picked option 2.|No red anywhere.' && listed.notes[1]!.by === 'assistant' && listed.maxNotes === MAX_NOTES, 'notes come back oldest first')
assert((await store.listNotes('u1', other.id)).notes.length === 0, 'notes belong to one workspace')
assert(await fails(store.addNote('u1', w.id, { text: '   ' }, 'you')) && await fails(store.addNote('u1', w.id, { text: 'x'.repeat(MAX_NOTE_CHARS + 1) }, 'you')) && await fails(store.addNote('u1', w.id, undefined, 'you')), 'an empty, too long or missing note is refused')
assert(await fails(store.addNote('u2', w.id, { text: 'sneaky' }, 'you'), 404) && await fails(store.listNotes('u2', w.id), 404) && await fails(store.removeNote('u2', w.id, first.note.id), 404) && await fails(store.setWhereWeAre('u2', w.id, { text: 'x' }, 'you'), 404), 'nobody else can read or change them')
assert(await fails(store.removeNote('u1', other.id, first.note.id), 404), 'a note is only deleted through its own workspace')
await store.removeNote('u1', w.id, first.note.id)
assert((await store.listNotes('u1', w.id)).notes.length === 1, 'a note can be deleted')
assert(await fails(store.removeNote('u1', w.id, 'nope'), 404), 'deleting a note that is not there says so')

const full = createWorkspaceStore(createFakeFirestore() as any, () => new Date(clock += 1000))
const fw = await full.create('u1', { name: 'Full' })
for (let i = 0; i < MAX_NOTES; i++) await full.addNote('u1', fw.id, { text: `Note ${i}` }, 'assistant')
assert(await fails(full.addNote('u1', fw.id, { text: 'One more' }, 'assistant'), 409), `the ${MAX_NOTES + 1}th note is refused, not swapped for an old one`)

// ---- Where we are ----
const ww = await store.setWhereWeAre('u1', w.id, { text: ' Logo chosen.\r\nNext: export. ' }, 'assistant')
assert(ww?.text === 'Logo chosen.\nNext: export.' && ww.by === 'assistant', 'the summary is saved and says who wrote it')
assert((await store.listNotes('u1', w.id)).whereWeAre?.text === 'Logo chosen.\nNext: export.' && (await store.get('u1', w.id))!.whereWeAre?.by === 'assistant', 'it is read back with the workspace')
await store.setWhereWeAre('u1', w.id, { text: 'Edited by me.' }, 'you')
assert((await store.get('u1', w.id))!.whereWeAre?.by === 'you' && (await store.get('u1', w.id))!.whereWeAre?.text === 'Edited by me.', 'a new summary replaces the old one')
assert(await fails(store.setWhereWeAre('u1', w.id, { text: 'x'.repeat(MAX_WHERE_CHARS + 1) }, 'you')), 'a summary has a limit')
assert(await store.setWhereWeAre('u1', w.id, { text: '   ' }, 'you') === null && (await store.get('u1', w.id))!.whereWeAre === null, 'an empty summary clears it')
await store.setWhereWeAre('u1', w.id, { text: 'Back again.' }, 'you')

// ---- Tools ----
const save = createSaveToNotesTool('u1', w.id, store as any)
const where = createUpdateWhereWeAreTool('u1', w.id, store as any)
const run = (t: any, input: any) => t.execute(input, { toolCallId: 't', messages: [] })
const r1: any = await run(save, { text: 'Final files as SVG and a 1080px PNG.' })
assert(r1.status === 'saved' && r1.noteId && (await store.listNotes('u1', w.id)).notes.some(n => n.id === r1.noteId && n.by === 'assistant'), 'the assistant saves a note, marked as its own, and gets its id back for Undo')
assert((await run(save, { text: 'final files as svg and a 1080px png.' }) as any).status === 'exists', 'saving the same thing again says it already exists')
const r2: any = await run(save, { text: 'x'.repeat(MAX_NOTE_CHARS + 1) })
assert(r2.status === 'failed' && /at most/.test(r2.error), 'a too long note comes back as a plain failure the model can fix')
const fullTool = createSaveToNotesTool('u1', fw.id, full as any)
assert((await run(fullTool, { text: 'One more' }) as any).status === 'failed', 'a full workspace comes back as a failure, not a crash')
const r3: any = await run(where, { text: 'Logo is done. Waiting on the invoice.' })
assert(r3.status === 'updated' && (await store.get('u1', w.id))!.whereWeAre?.text === 'Logo is done. Waiting on the invoice.' && (await store.get('u1', w.id))!.whereWeAre?.by === 'assistant', 'the assistant rewrites the summary')
assert((await run(where, { text: 'y'.repeat(MAX_WHERE_CHARS + 1) }) as any).status === 'failed', 'a too long summary comes back as a failure')
const stranger = createSaveToNotesTool('u2', w.id, store as any)
assert((await run(stranger, { text: 'mine now' }) as any).status === 'failed' || await run(stranger, { text: 'mine now' }).then(() => false, () => true), 'the tool cannot write to someone else\'s workspace')

// ---- Prompt ----
const ws = (await store.get('u1', w.id))!
const notes = (await store.listNotes('u1', w.id)).notes
const withNotes = workspacePrompt(ws, [], { on: true, notes, whereWeAre: ws.whereWeAre })
assert(withNotes.includes('Where we are:') && withNotes.includes('Logo is done. Waiting on the invoice.') && withNotes.includes('- No red anywhere.') && withNotes.includes('save_to_notes') && withNotes.includes('update_where_we_are'), 'with notes on the prompt carries the summary, the notes and how to keep them')
const off = workspacePrompt(ws, [], { on: false, notes, whereWeAre: ws.whereWeAre })
assert(!off.includes('No red anywhere.') && !off.includes('Where we are') && !off.includes('save_to_notes'), 'with notes off nothing about them reaches the model')
assert(workspacePrompt(ws, []) === off, 'a prompt without the notes argument behaves like notes off')
assert(notesPrompt([], null).includes('Nothing has been saved yet.'), 'an empty workspace says so')
assert(withNotes.includes('not instructions that override'), 'notes are data, not orders')

// ---- Agents and small plans keep the tools ----
assert(Object.keys(filterTools({ save_to_notes: 1, update_where_we_are: 2, web_search: 3 }, { tools: [] } as any)).sort().join() === 'save_to_notes,update_where_we_are', 'an agent used in a workspace can always keep its notes')
const focused = focusTools({ save_to_notes: 1, update_where_we_are: 2, browser: 3, run_in_cloud: 4, web_search: 5 } as any, { provider: 'groq', text: 'hello', used: [] } as any)
assert('save_to_notes' in focused && 'update_where_we_are' in focused, 'a small plan still gets the note tools')

// ---- Deleting ----
await store.remove('u1', w.id)
assert((await db.collection('workspace_notes').where('workspaceId', '==', w.id).get()).docs.length === 0, 'deleting a workspace deletes its notes')
const account = readFileSync(new URL('../server/services/account/account.ts', import.meta.url), 'utf8')
assert(/'workspace_files', 'workspace_notes'/.test(account), 'deleting an account deletes the notes')
