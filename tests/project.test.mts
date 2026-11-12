import vm from 'node:vm'
import JSZip from 'jszip'
import { diffLines, countChanges } from '../shared/lineDiff'
import { pageProblem } from '../shared/pageHtml'
import { bundleProject, cleanPath, PROJECT_LIMITS, projectProblem, ProjectError } from '../shared/project'
import { buildArtifactFile, buildProjectPage, outline, parseSpec } from '../server/services/artifacts/model'
import type { ProjectSpec } from '../server/services/artifacts/model'
import { createArtifactStore } from '../server/services/artifacts/store'
import { openFileNote } from '../server/services/artifacts/context'
import { createProjectTools } from '../server/utils/tools/projectFiles'
import type { ProjectToolDeps } from '../server/utils/tools/projectFiles'
import { createFakeFirestore } from './fakeFirestore'

const assert = (c: unknown, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const refused = (fn: () => unknown) => { try { fn(); return null } catch (e: any) { return e } }

// ---------- file names ----------
assert(cleanPath('./src//app.js') === 'src/app.js' && cleanPath('a\\b.txt') === 'a/b.txt', 'file names are tidied')
for (const bad of ['../x', '/etc/passwd', 'C:\\x', 'src/', 'a/../b', '.env', 'config/.env.local', 'keys/id_rsa', 'src/.git/config', 'node_modules/x/index.js', 'a$b', ''])
  assert(refused(() => cleanPath(bad)) instanceof ProjectError, `"${bad}" is refused as a file name`)
assert(cleanPath('.env.example') === '.env.example', 'a placeholder env file is allowed')

// ---------- limits ----------
const f = (path: string, content = 'x') => ({ path, content })
assert(projectProblem([f('a.js'), f('b.js')]) === null, 'a small project is fine')
assert(projectProblem(Array.from({ length: PROJECT_LIMITS.files + 1 }, (_, i) => f(`f${i}.txt`)))?.includes('up to'), 'too many files is refused')
assert(projectProblem([f('big.js', 'x'.repeat(PROJECT_LIMITS.fileChars + 1))])?.includes('over the'), 'a file that is too long is refused')
assert(projectProblem(Array.from({ length: 7 }, (_, i) => f(`p${i}.js`, 'x'.repeat(90_000))))?.includes('limit'), 'a project that is too big is refused')
assert(projectProblem([f('a.js'), f('a.js')])?.includes('twice'), 'the same file twice is refused')
assert(projectProblem([f('a.bin', 'a\u0000b')])?.includes('text only'), 'a binary file is refused')

// ---------- what changed ----------
assert(JSON.stringify(countChanges('a\nb\nc', 'a\nB\nc')) === '{"added":1,"removed":1}', 'one changed line counts as one added and one removed')
assert(JSON.stringify(countChanges('a\nb', 'a\nb\nc\nd')) === '{"added":2,"removed":0}', 'added lines are counted')
assert(JSON.stringify(countChanges('a\nb\nc', 'a')) === '{"added":0,"removed":2}', 'removed lines are counted')
assert(JSON.stringify(countChanges('same\n', 'same\n')) === '{"added":0,"removed":0}', 'no change is no change')
const dl = diffLines('1\n2\n3\n4', '1\nx\n3\ny\n4')
assert(dl.lines.map(l => (l.kind === 'same' ? ' ' : l.kind === 'add' ? '+' : '-') + l.text).join('|') === ' 1|-2|+x| 3|+y| 4', 'the diff lists lines in order with removed lines beside added ones')
assert(dl.lines.find(l => l.text === 'x')?.newNo === 2 && dl.lines.find(l => l.text === '2')?.oldNo === 2, 'the diff keeps line numbers')
const huge = diffLines(Array.from({ length: 2000 }, (_, i) => `a${i}`).join('\n'), Array.from({ length: 2000 }, (_, i) => `b${i}`).join('\n'))
assert(huge.added === 2000 && huge.removed === 2000, 'a huge rewrite does not take forever')

// ---------- one page from a project ----------
const tip = [
  f('index.html', '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><img src="logo.svg" alt=""><p id="out"></p><script type="module" src="src/app.js"></script></body></html>'),
  f('style.css', 'body{color:red}'),
  f('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'),
  f('src/app.js', "import { split, TIP as t } from './split.js'\nimport fmt, * as util from './fmt.js'\nimport './side.js'\nexport const x = 1\ndocument.getElementById('out').textContent = fmt(split(120, t, 3)) + util.unit + globalThis.side\n"),
  f('src/split.js', 'export const TIP = 10\nexport function split(bill, tip, n) {\n  return (bill * (1 + tip / 100)) / n\n}\n'),
  f('src/fmt.js', "export default function fmt(n) { return n.toFixed(2) }\nconst unit = ' GHS'\nexport { unit }\n"),
  f('src/side.js', "globalThis.side = '!'\n")
]
const one: any = bundleProject(tip)
assert(!one.problem && !one.html.includes('src="src/app.js"') && one.html.includes('<style>') && one.html.includes('data:image/svg+xml'), 'styles, scripts and svg pictures go inside the page')
assert(pageProblem(one.html) === null, 'the one page passes the same page rules as any page')
const el: any = { textContent: '' }
const sandbox: any = { document: { getElementById: () => el }, globalThis: {} }
sandbox.globalThis = sandbox
vm.runInNewContext(/<script>\n([\s\S]*?)\n<\/script>/.exec(one.html)![1]!, sandbox)
assert(el.textContent === '44.00 GHS!', 'scripts that import each other still run once joined into one')
assert((bundleProject([f('index.html', '<script src="a.js"></script>'), f('a.js', 'var s = "</script><b>"')]) as any).html.includes('<\\/script><b>'), 'a closing script tag inside a script cannot end it early')
assert((bundleProject([f('index.html', '<script type="module">import {a} from "./a.js"; document.title = a</script>'), f('a.js', 'export const a = "hi"')]) as any).html.includes('"use strict"'), 'a module written inside the page is joined too')
assert((bundleProject([f('index.html', '<script type="module" src="a.js"></script>'), f('a.js', "import x from 'react'")]) as any).problem?.includes('package'), 'a package import says why it cannot be previewed')
assert((bundleProject([f('index.html', '<script src="gone.js"></script>')]) as any).problem?.includes('no such file'), 'a missing script is named')
assert((bundleProject([f('notes.txt')]) as any).problem?.includes('index.html'), 'a project with no page says so')
assert((bundleProject([f('index.html', '<link rel="stylesheet" href="https://x.com/a.css"><p>hi</p>')]) as any).html.includes('https://x.com/a.css'), 'a web address is left alone, so the page rules can refuse it')

// ---------- as a project file ----------
const spec = parseSpec('project', { title: 'Tip calculator', files: tip }) as ProjectSpec
assert(outline('project', spec)[0] === '7 files' && outline('project', spec).includes('src/app.js (5 lines)'), 'the outline lists the files')
assert(refused(() => parseSpec('project', { title: 'x', files: [f('../x')] })) !== null, 'a project with a bad file name does not save')
const zip = await JSZip.loadAsync((await buildArtifactFile('project', 'zip', spec)).bytes)
assert(Object.keys(zip.files).filter(n => !n.endsWith('/')).sort()[0] === 'Tip-calculator/index.html' && await zip.file('Tip-calculator/src/split.js')!.async('string') === tip[4]!.content, 'the zip has every file inside one folder')
assert('bytes' in buildProjectPage(spec) && 'problem' in buildProjectPage({ title: 'x', files: [f('a.txt')] }), 'the single page is built, or the reason is given')

// ---------- the tools ----------
const db: any = createFakeFirestore()
const store = createArtifactStore(db)
const deps: ProjectToolDeps = { find: store.findProjectForChat, get: store.getArtifact, create: store.createArtifact, save: store.saveVersion }
const tools = (user = 'u1', chat = 'c1', request = 'r1') => createProjectTools(user, { chatId: chat, requestId: request }, deps)
const run = (t: any, input: any): Promise<any> => t.execute(input, { toolCallId: 'x', messages: [] })

let t = tools()
const empty = await run(t.list_files, {})
assert(empty.status === 'ok' && empty.count === 0 && empty.message.includes('write_file'), 'a new chat has no files and is told how to start')
assert((await run(t.read_file, { path: 'a.js' })).status === 'failed', 'reading before there is a project fails plainly')

const w1 = await run(t.write_file, { path: 'index.html', content: '<p>hi</p>\n', projectName: 'tip-calculator' })
assert(w1.status === 'ok' && w1.projectCreated && w1.version === 1 && w1.title === 'tip-calculator' && w1.created && w1.added === 1, 'the first file makes the project')
const w2 = await run(t.write_file, { path: 'src/split.js', content: 'export const a = 1\nexport const b = 2\nexport const c = 3\n' })
assert(w2.status === 'ok' && !w2.projectCreated && w2.version === 1, 'more files in the same reply stay one version')
const w3 = await run(t.write_file, { path: 'src/split.js', content: 'export const a = 1\nexport const b = 22\nexport const c = 3\n' })
assert(w3.created === false && w3.added === 1 && w3.removed === 1 && w3.version === 1, 'writing over a file counts what changed')
const bad = await run(t.write_file, { path: '.env', content: 'KEY=1' })
assert(bad.status === 'failed' && bad.error.includes('secrets'), 'a secrets file is refused')
assert((await run(t.write_file, { path: '../x.js', content: 'x' })).status === 'failed', 'a path outside the project is refused')

const listed = await run(t.list_files, {})
assert(listed.count === 2 && listed.files[0].path === 'index.html' && listed.files[1].lines === 3, 'the files are listed with their length')
assert((await run(t.list_files, { folder: 'src' })).count === 1, 'a folder can be listed on its own')

const rd = await run(t.read_file, { path: 'src/split.js' })
assert(rd.content.startsWith('1\texport const a = 1') && rd.totalLines === 3 && !rd.nextFromLine, 'a file is read with line numbers')
assert((await run(t.read_file, { path: 'src/split.js', fromLine: 2, toLine: 2 })).content === '2\texport const b = 22', 'part of a file can be read')
assert((await run(t.read_file, { path: 'nope.js' })).error.includes('list_files'), 'a missing file points to list_files')
await run(t.write_file, { path: 'long.txt', content: Array.from({ length: 900 }, (_, i) => `line ${i + 1}`).join('\n') })
const part = await run(t.read_file, { path: 'long.txt' })
assert(part.toLine === 400 && part.nextFromLine === 401, 'a long file is read in parts with a place to continue')

const found = await run(t.search_files, { query: 'EXPORT const b' })
assert(found.count === 1 && found.matches[0].path === 'src/split.js' && found.matches[0].line === 2, 'search finds words in any file, ignoring capitals')
assert((await run(t.search_files, { query: 'EXPORT', matchCase: true })).count === 0, 'search can match capitals exactly')
assert((await run(t.search_files, { query: 'line', folder: 'src' })).count === 0, 'search can stay inside a folder')
assert((await run(t.search_files, { query: 'line' })).note.includes('first 40'), 'a search with too many matches says it was cut')

const e1 = await run(t.edit_project_file, { path: 'src/split.js', edits: [{ find: 'b = 22', replace: 'b = 2' }, { find: 'c = 3', replace: 'c = 30' }] })
assert(e1.status === 'ok' && e1.added === 2 && e1.removed === 2 && e1.edits === 2, 'edits inside a file are applied and counted')
const e2 = await run(t.edit_project_file, { path: 'src/split.js', edits: [{ find: 'export const', replace: 'const' }] })
assert(e2.status === 'failed' && e2.error.includes('3 times') && e2.error.includes('Nothing was changed'), 'text found more than once is refused')
const e3 = await run(t.edit_project_file, { path: 'src/split.js', edits: [{ find: 'a = 1', replace: 'a = 10' }, { find: 'not there', replace: 'x' }] })
assert(e3.status === 'failed' && (await run(t.read_file, { path: 'src/split.js' })).content.includes('a = 1\n'), 'when one edit fails none are kept')
assert((await run(t.edit_project_file, { path: 'src/split.js', edits: [{ find: 'export const', replace: 'const', all: true }] })).added === 3, 'all changes every place')
assert((await run(t.edit_project_file, { path: 'zzz.js', edits: [{ find: 'a', replace: 'b' }] })).status === 'failed', 'editing a missing file fails')

const gone = await run(t.delete_file, { path: 'long.txt' })
assert(gone.status === 'ok' && (await run(t.list_files, {})).count === 2 && (await run(t.delete_file, { path: 'long.txt' })).status === 'failed', 'a file can be deleted once')

// Several calls in one step do not overwrite each other.
await Promise.all(['a', 'b', 'c', 'd'].map(n => run(t.write_file, { path: `many/${n}.txt`, content: n })))
assert((await run(t.list_files, { folder: 'many' })).count === 4, 'writes made together are all kept')

// ---------- versions and owners ----------
const meta = (await store.findProjectForChat('u1', 'c1'))!
assert(meta.latest === 1, 'a whole reply is one version')
t = tools('u1', 'c1', 'r2')
const w4 = await run(t.write_file, { path: 'README.md', content: '# Tip\n' })
assert(w4.version === 2 && (await run(t.list_files, {})).count === 7, 'the next reply is the next version')
await run(t.edit_project_file, { path: 'README.md', edits: [{ find: '# Tip', replace: '# Tip calculator' }] })
assert((await store.findProjectForChat('u1', 'c1'))!.latest === 2, 'more work in that reply stays in it')
const back = await store.moveHead('u1', meta.id, 1)
assert((back.spec as ProjectSpec).files.length === 6 && !(back.spec as ProjectSpec).files.some(x => x.path === 'README.md'), 'undo takes the whole reply back')
assert((await store.getVersionSpec('u1', meta.id, 2)) !== null && (await store.getVersionSpec('u2', meta.id, 1)) === null && (await store.getVersionSpec('u1', meta.id, 9)) === null, 'an older version is only given to its owner, and only while it is kept')
assert((await run(tools('u2', 'c1').list_files, {})).count === 0, 'another person does not see the project')
assert((await run(tools('u1', 'c2').list_files, {})).count === 0, 'another chat has its own project')
assert((await store.findProjectForChat('u1', 'c1'))!.id === meta.id, 'a chat keeps one project')

// The note about the open project points at the project tools, not edit_file.
const pNote = await openFileNote('u1', { artifactId: meta.id }, store.getArtifact)
assert(pNote.includes('edit_project_file') && pNote.includes('Do not use edit_file') && !pNote.includes('use edit_file with this artifactId') && pNote.includes('src/split.js'), 'the open project note names the project tools and lists the files')
assert(await openFileNote('u2', { artifactId: meta.id }, store.getArtifact) === '', 'someone else\'s project adds nothing')
