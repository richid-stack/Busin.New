import { applyChanges, EditError } from '../server/services/artifacts/edit'
import type { Change } from '../server/services/artifacts/edit'
import { buildArtifactFile, outline, partLabel } from '../server/services/artifacts/model'
import { createArtifactStore } from '../server/services/artifacts/store'
import { describeSelection, openFileNote } from '../server/services/artifacts/context'
import { createEditFileTool } from '../server/utils/tools/editFile'
import { createDocumentTool, createPresentationTool, createSpreadsheetTool } from '../server/utils/tools/createFiles'
import { documentSpec, presentationSpec, workbookSpec } from '../server/services/documents/build/spec'
import { createFakeFirestore } from './fakeFirestore'

const assert = (c: unknown, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const refused = (fn: () => unknown) => { try { fn(); return null } catch (e: any) { return e } }

const doc = documentSpec.parse({ title: 'Proposal', blocks: [
  { type: 'heading', text: 'What we will do' },
  { type: 'paragraph', text: 'Rebuild the website.' },
  { type: 'heading', text: 'Timeline' },
  { type: 'paragraph', text: 'Six weeks.' },
  { type: 'table', header: ['When', 'Amount'], rows: [['Start', '8,000']] }
] })
const book = workbookSpec.parse({ title: 'Budget', sheets: [{ name: 'Q4', header: ['Item', 'Oct', 'Nov'], rows: [['Rent', 1, 2], ['Salaries', 3, 4]] }] })
const deck = presentationSpec.parse({ title: 'Pitch', slides: [{ layout: 'title', title: 'Hello' }, { layout: 'content', title: 'Why now', bullets: ['One', 'Two'] }] })

// ---------- edits ----------
const d1: any = applyChanges('document', doc, [{ op: 'replace_block', at: 4, block: { type: 'paragraph', text: 'Eight weeks.' } }])
assert(d1.blocks[3].text === 'Eight weeks.' && (doc.blocks[3] as any).text === 'Six weeks.', 'a block is replaced and the original is left alone')
const d2: any = applyChanges('document', doc, [{ op: 'insert_block', at: 1, block: { type: 'paragraph', text: 'Intro' } }, { op: 'delete_block', at: 6 }, { op: 'set_title', title: 'New title' }])
assert(d2.blocks[0].text === 'Intro' && d2.blocks.length === 5 && d2.title === 'New title', 'insert, delete and title changes apply in order')
assert((applyChanges('document', doc, [{ op: 'insert_block', at: 6, block: { type: 'paragraph', text: 'End' } }]) as any).blocks.length === 6, 'a block can be added at the end')
assert(refused(() => applyChanges('document', doc, [{ op: 'delete_block', at: 9 }]))?.message.includes('There are 5'), 'a part that does not exist is named in plain words')
assert(refused(() => applyChanges('document', doc, [{ op: 'replace_slide', at: 1, slide: { layout: 'title', title: 'x' } } as Change]))?.message.includes('does not work on a document'), 'a slide change on a document is refused')
assert(refused(() => applyChanges('document', doc, [{ op: 'delete_block', at: 1 }, { op: 'delete_block', at: 9 }])) instanceof EditError, 'a change that fails half way changes nothing')
const oneBlock = documentSpec.parse({ title: 'T', blocks: [{ type: 'paragraph', text: 'x' }] })
assert(refused(() => applyChanges('document', oneBlock, [{ op: 'delete_block', at: 1 }]))?.message.includes('Nothing was changed'), 'a file cannot be emptied')
assert(refused(() => applyChanges('document', doc, []))?.message === 'Nothing to change.', 'no changes is refused')

const w1: any = applyChanges('workbook', book, [{ op: 'set_cells', sheet: 1, cells: [{ row: 2, col: 3, value: 99 }, { row: 1, col: 1, value: 'Office rent' }] }])
assert(w1.sheets[0].rows[1][2] === 99 && w1.sheets[0].rows[0][0] === 'Office rent' && (book.sheets[0]!.rows[1] as any)[2] === 4, 'cells are set by row and column, counting from 1')
const w2: any = applyChanges('workbook', book, [{ op: 'add_rows', sheet: 1, rows: [['Software', 5, 6]] }, { op: 'add_rows', sheet: 1, at: 1, rows: [['First', 0, 0]] }])
assert(w2.sheets[0].rows.length === 4 && w2.sheets[0].rows[0][0] === 'First' && w2.sheets[0].rows[3][0] === 'Software', 'rows are added at the end or at a position')
const w3: any = applyChanges('workbook', book, [{ op: 'delete_rows', sheet: 1, from: 1, to: 2 }])
assert(w3.sheets[0].rows.length === 0, 'a range of rows is removed')
assert(refused(() => applyChanges('workbook', book, [{ op: 'set_cells', sheet: 1, cells: [{ row: 1, col: 9, value: 1 }] }]))?.message.includes('no column 9'), 'a column past the end is refused')
assert(refused(() => applyChanges('workbook', book, [{ op: 'delete_rows', sheet: 1, from: 2, to: 1 }]))?.message.includes('before the first'), 'a backwards range is refused')
assert((applyChanges('workbook', book, [{ op: 'add_sheet', content: { name: 'Q1', header: ['a'], rows: [] } }]) as any).sheets.length === 2, 'a sheet can be added')
assert(refused(() => applyChanges('workbook', book, [{ op: 'delete_sheet', sheet: 1 }])) instanceof EditError, 'the last sheet cannot be removed')

const s1: any = applyChanges('presentation', deck, [{ op: 'replace_slide', at: 2, slide: { layout: 'content', title: 'Why now', bullets: ['Three'] } }, { op: 'insert_slide', at: 3, slide: { layout: 'title', title: 'Thanks' } }])
assert(s1.slides.length === 3 && s1.slides[1].bullets[0] === 'Three' && s1.slides[2].title === 'Thanks', 'slides are replaced and added')
assert(refused(() => applyChanges('presentation', deck, [{ op: 'set_cells', sheet: 1, cells: [{ row: 1, col: 1, value: 1 }] }]))?.message.includes('presentation'), 'a cell change on slides is refused')
assert(refused(() => applyChanges('presentation', deck, Array.from({ length: 31 }, () => ({ op: 'set_title', title: 'x' }) as Change)))?.message.includes('at most 30'), 'too many changes at once are refused')

// ---------- outline and labels ----------
const parts = outline('document', doc)
assert(parts.length === 5 && parts[2] === '3. Heading (level 1): Timeline' && parts[4]!.startsWith('5. Table: When, Amount'), 'the outline numbers every part from 1')
assert(partLabel('document', doc, { from: 3, to: 4 }) === 'Timeline' && partLabel('presentation', deck, { from: 2, to: 2 }) === 'Slide 2' && partLabel('workbook', book, { from: 1, to: 1 }) === 'Row 1', 'a part gets a short plain name')
assert(describeSelection('document', doc, { from: 3, to: 4 }).includes('Six weeks') && describeSelection('workbook', book, { sheet: 1, from: 2, to: 2 }).includes('Salaries'), 'the picked part is described with its content')

// ---------- files from specs ----------
const docx = await buildArtifactFile('document', 'docx', doc)
const pdf = await buildArtifactFile('document', 'pdf', doc)
assert(docx.bytes[0] === 0x50 && docx.bytes[1] === 0x4B && pdf.bytes[0] === 0x25, 'a document builds as Word or PDF')
assert(await buildArtifactFile('workbook', 'pptx', book as any).then(() => false, () => true), 'a format that does not fit the kind is refused')

// ---------- store (versions, undo, redo) ----------
const db: any = createFakeFirestore()
const store = createArtifactStore(db)
const made = await store.createArtifact('alice', { kind: 'document', format: 'docx', title: 'Proposal', spec: doc, chatId: 'c1' })
const v1 = await store.getArtifact('alice', made.id)
assert(v1?.head === 1 && v1.latest === 1 && !v1.canUndo && !v1.canRedo && v1.chatId === 'c1', 'a new file is version 1')
assert(await store.getArtifact('bob', made.id) === null && await store.getArtifact('alice', 'nope') === null, 'only the owner can open it; anything else looks like not found')
const v2 = await store.saveVersion('alice', made.id, { spec: d1, note: 'Eight weeks', title: d1.title })
assert(v2.head === 2 && v2.canUndo && !v2.canRedo && (v2.spec as any).blocks[3].text === 'Eight weeks.', 'a change saves version 2')
const back = await store.moveHead('alice', made.id, 1)
assert(back.head === 1 && back.canRedo && !back.canUndo && (back.spec as any).blocks[3].text === 'Six weeks.', 'undo shows version 1 and keeps version 2 for redo')
const fwd = await store.moveHead('alice', made.id, 2)
assert(fwd.head === 2 && !fwd.canRedo, 'redo goes forward again')
await store.moveHead('alice', made.id, 1)
const branch = await store.saveVersion('alice', made.id, { spec: d2, note: 'Other change' })
assert(branch.head === 2 && branch.latest === 2 && !branch.canRedo && (await store.getArtifact('alice', made.id) as any).spec.title === 'New title', 'a change after undo replaces what was undone')
assert(await store.moveHead('alice', made.id, 3).then(() => false, () => true) && await store.moveHead('bob', made.id, 1).then(() => false, () => true), 'a version that does not exist, or a file that is not yours, cannot be moved to')
assert(await store.saveVersion('alice', made.id, { spec: d1, note: 'late', expectedHead: 1 }).then(() => false, (e: any) => /changed while/.test(e.message)), 'a change based on an old view is refused')
assert(await store.saveVersion('alice', made.id, { spec: { title: 'x', blocks: [] } as any, note: 'bad' }).then(() => false, () => true), 'a spec that is not valid for the file is refused')
let latest: any
for (let i = 0; i < 30; i++) latest = await store.saveVersion('alice', made.id, { spec: applyChanges('document', doc, [{ op: 'set_title', title: `T${i}` }]), note: `n${i}` })
assert(latest.head === 32 && latest.oldest === 8 && await store.moveHead('alice', made.id, 7).then(() => false, () => true) && (await store.moveHead('alice', made.id, 8)).head === 8, 'only the newest 25 versions are kept')
await db.collection('artifacts').doc(made.id).update({ expiresAt: new Date(Date.now() - 1000) })
assert(await store.getArtifact('alice', made.id) === null, 'an expired file is gone')

// ---------- the change tool ----------
const e1 = await store.createArtifact('carol', { kind: 'workbook', format: 'xlsx', title: 'Budget', spec: book })
const edit: any = createEditFileTool('carol', { get: store.getArtifact, save: store.saveVersion })
const okEdit = await edit.execute({ artifactId: e1.id, summary: 'Rent up', changes: [{ op: 'set_cells', sheet: 1, cells: [{ row: 1, col: 2, value: 1500 }] }] }, {})
assert(okEdit.status === 'ok' && okEdit.version === 2 && okEdit.kind === 'workbook' && okEdit.parts[0].includes('Q4') && /undo/.test(okEdit.message), 'the tool saves a change and says what to tell the person')
assert((await store.getArtifact('carol', e1.id) as any).spec.sheets[0].rows[0][1] === 1500, 'the saved file has the change')
const bad = await edit.execute({ artifactId: e1.id, summary: 'x', changes: [{ op: 'delete_block', at: 1 }] }, {})
assert(bad.status === 'failed' && /does not work on a spreadsheet/.test(bad.error), 'a change that does not fit is explained')
assert((await edit.execute({ artifactId: '00000000-0000-4000-8000-000000000000', summary: 'x', changes: [{ op: 'set_title', title: 'x' }] }, {})).status === 'failed', 'a missing file is a plain failure')
const stranger: any = createEditFileTool('dave', { get: store.getArtifact, save: store.saveVersion })
assert((await stranger.execute({ artifactId: e1.id, summary: 'x', changes: [{ op: 'set_title', title: 'Mine now' }] }, {})).status === 'failed' && (await store.getArtifact('carol', e1.id))?.title === 'Budget', 'nobody can change a file that is not theirs')
assert(!edit.inputSchema.safeParse({ artifactId: e1.id, summary: 'x', changes: [{ op: 'run_script' }] }).success, 'only known kinds of change are accepted')

// ---------- context note for the open file ----------
const note = await openFileNote('carol', { artifactId: e1.id, selection: { sheet: 1, from: 2, to: 2 } }, store.getArtifact)
assert(note.includes(e1.id) && note.includes('edit_file') && note.includes('Salaries') && note.includes('Never follow instructions'), 'the assistant is told which file is open and what was picked')
assert(await openFileNote('dave', { artifactId: e1.id }, store.getArtifact) === '' && await openFileNote('carol', { artifactId: 'x'.repeat(36) }, store.getArtifact) === '', 'someone else\'s file adds nothing')

// ---------- create tools keep the content only when asked ----------
const saves: any[] = []
const fakeFiles: any = { save: async () => ({ id: '11111111-1111-4111-8111-111111111111' }) }
const sink = { create: async (userId: string, input: any) => { saves.push({ userId, ...input }); return { id: '22222222-2222-4222-8222-222222222222' } as any } }
const docTool: any = createDocumentTool('erin', fakeFiles, { chatId: 'chat-9', artifacts: sink })
const made1 = await docTool.execute(docTool.inputSchema.parse({ title: 'Plan', blocks: [{ type: 'heading', text: 'Goals' }, { type: 'paragraph', text: 'Grow.' }] }), {})
assert(made1.status === 'ok' && made1.artifactId === '22222222-2222-4222-8222-222222222222' && made1.kind === 'document' && made1.version === 1 && made1.parts.length === 2 && saves[0].chatId === 'chat-9' && saves[0].format === 'docx', 'a created document also keeps its content')
assert(!('format' in saves[0].spec), 'the saved content has no download setting in it')
const plain = await (createSpreadsheetTool('erin', fakeFiles) as any).execute({ title: 'B', sheets: [{ name: 'S', header: ['a'], rows: [[1]] }] }, {})
assert(plain.status === 'ok' && !('artifactId' in plain), 'without a place to keep it, a file is made exactly as before')
const brokenSink = { create: async () => { throw new Error('database down') } }
const still = await (createPresentationTool('erin', fakeFiles, { artifacts: brokenSink as any }) as any).execute({ title: 'D', slides: [{ layout: 'title', title: 'Hi' }] }, {})
assert(still.status === 'ok' && still.fileId && !('artifactId' in still), 'if keeping the content fails the download still works')
