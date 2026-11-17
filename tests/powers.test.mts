import { createFakeFirestore } from './fakeFirestore'
import { DEFAULT_POWERS, applyPowers, powerOf, readPowers } from '../shared/powers'
import { getPowers, setPowers } from '../server/services/account/powers'
import { setNotificationSettings } from '../server/services/notifications/notify'
import { setBrowserWhere } from '../server/services/browser/where'
import { buildTaskTools } from '../server/services/tasks/tools'
import { TASK_TOOL_GROUPS } from '../server/services/tasks/model'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

// ---- Reading what is stored ----
assert(JSON.stringify(readPowers(undefined)) === JSON.stringify(DEFAULT_POWERS), 'nothing stored means everything is on')
assert(readPowers({ web: false }).web === false && readPowers({ web: false }).browser === true, 'only an explicit false switches a power off')
assert(readPowers({ web: 'no', cloud: 0, apps: null }).web === true && readPowers({ web: 'no', cloud: 0, apps: null }).cloud === true, 'a damaged value never takes a power away')
assert(readPowers('garbage').apps === true && readPowers(42).apps === true, 'a stored value of the wrong shape is ignored')

// ---- Which tools belong to which power ----
assert(powerOf('web_search') === 'web' && powerOf('find_photos') === 'web' && powerOf('github_read') === 'web', 'search, fetch and photo tools are the web')
assert(powerOf('browser') === 'browser' && powerOf('run_in_cloud') === 'cloud', 'the browser and the cloud box have their own powers')
assert(powerOf('run_on_computer') === 'computer' && powerOf('computer_excel') === 'computer' && powerOf('look_in_folder') === 'computer', 'everything that reaches the computer is one power')
assert(powerOf('integration_execute') === 'apps' && powerOf('mcp_github_search') === 'apps' && powerOf('add_tool_server') === 'apps', 'connected apps include tool servers')
assert(['chart', 'calculator', 'create_document', 'edit_file', 'remember', 'load_skill', 'find_skill', 'read_document', 'plan'].every(n => powerOf(n) === null), 'charts, files, memory and skills are never switched off here')

// ---- Taking tools away ----
const all = { web_search: 1, web_fetch: 2, browser: 3, run_in_cloud: 4, integration_execute: 5, mcp_x_y: 6, chart: 7, create_document: 8 }
assert(applyPowers(all, undefined) === all && Object.keys(applyPowers(all, DEFAULT_POWERS)).length === 8, 'with everything on nothing is removed')
assert(Object.keys(applyPowers(all, { web: false })).sort().join() === 'browser,chart,create_document,integration_execute,mcp_x_y,run_in_cloud', 'web off removes search and fetch only')
assert(Object.keys(applyPowers(all, { apps: false, cloud: false })).sort().join() === 'browser,chart,create_document,web_fetch,web_search', 'several powers can be off at once, tool servers included')
assert(Object.keys(applyPowers(all, { web: false, browser: false, computer: false, cloud: false, apps: false })).sort().join() === 'chart,create_document', 'with every power off only the always-available tools are left')
assert(Object.keys(all).length === 8, 'the original list is not changed')

// ---- Stored per person, next to the other settings ----
const db = createFakeFirestore()
assert(JSON.stringify(await getPowers(db as any, 'p1')) === JSON.stringify(DEFAULT_POWERS), 'a new person has everything on')
await setNotificationSettings(db as any, 'p1', { emailRenewals: false })
await setBrowserWhere(db as any, 'p1', 'computer')
const afterOff = await setPowers(db as any, 'p1', { cloud: false })
assert(afterOff.cloud === false && afterOff.web === true, 'one power changes alone')
const kept = db.raw('user_settings').get('p1')!
assert(kept.emailRenewals === false && kept.browserWhere === 'computer' && kept.userId === 'p1', 'the email switches and browser place in the same record are kept')
await setPowers(db as any, 'p1', { web: false })
const both = await getPowers(db as any, 'p1')
assert(both.web === false && both.cloud === false && both.apps === true, 'earlier choices survive a later change')
await setPowers(db as any, 'p1', { cloud: true, web: 'x' as any })
const back = await getPowers(db as any, 'p1')
assert(back.cloud === true && back.web === false, 'switching back on works, and a non-boolean value is ignored')
assert((await getPowers(db as any, 'p2')).web === true, 'another person is not affected')
const broken = { collection: () => { throw new Error('database down') } }
assert(JSON.stringify(await getPowers(broken as any, 'p1')) === JSON.stringify(DEFAULT_POWERS), 'if the record cannot be read everything stays on, so a chat is never broken by it')

// ---- A task is built with the powers too ----
const names = (powers?: any) => Object.keys(buildTaskTools('u1', [...TASK_TOOL_GROUPS], undefined, null, null, powers))
assert(names().includes('web_search') && names({ web: false }).every(n => !['web_search', 'web_fetch', 'fetch_file', 'find_photos', 'github_read'].includes(n)), 'a task without the web power gets no web tools')
assert(names({ web: false }).includes('chart') && names({ web: false }).includes('create_document'), 'but keeps the rest')

// ---- Delete all chats ----
import { deleteAllChatsFor } from '../server/utils/firebase'
const cdb = createFakeFirestore()
for (const [id, userId, extra] of [['c1', 'me', {}], ['c2', 'me', { workspaceId: 'w1' }], ['c3', 'me', { ghost: true }], ['c4', 'someone-else', {}]] as const) {
  await (cdb as any).collection('chats').doc(id).set({ userId, title: id, ...extra })
  await (cdb as any).collection('chats').doc(id).collection('messages').doc('m1').set({ text: 'hello' })
}
await (cdb as any).collection('workspaces').doc('w1').set({ userId: 'me', name: 'Shop' })
await (cdb as any).collection('user_settings').doc('me').set({ userId: 'me' })
const removed = await deleteAllChatsFor(cdb as any, 'me')
assert(removed === 3, 'it removes every chat of the person, a ghost chat and one in a workspace included')
assert(!cdb.raw('chats').has('c1') && !cdb.raw('chats').has('c2') && !cdb.raw('chats').has('c3'), 'those chats are gone')
assert(cdb.raw('chats').has('c4'), 'another person\'s chat is untouched')
assert(cdb.raw('workspaces').has('w1') && cdb.raw('user_settings').has('me'), 'workspaces and settings stay')
assert(await deleteAllChatsFor(cdb as any, 'me') === 0, 'asking again is harmless')
