import { useFirebaseDbForTests } from '../server/utils/firebaseAdmin'
import { createFakeFirestore } from './fakeFirestore'
import { AccountDeletionError, collectUserData, eraseUserData, plain } from '../server/services/account/account'
import type { AccountDeps } from '../server/services/account/account'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e } return null }

const db = createFakeFirestore()
useFirebaseDbForTests(db as any)

const seed = async (uid: string) => {
  await db.collection('chats').doc(`c-${uid}`).set({ userId: uid, title: `${uid} chat`, createdAt: new Date('2026-01-02T03:04:05Z') })
  await db.collection('chats').doc(`c-${uid}`).collection('messages').doc('m1').set({ role: 'user', parts: [{ type: 'text', text: `hello from ${uid}` }] })
  await db.collection('chats').doc(`c-${uid}`).collection('votes').doc('m1').set({ userId: uid, isUpvoted: true })
  await db.collection('workflows').doc(`w-${uid}`).set({ userId: uid, name: 'Flow' })
  await db.collection('workflows').doc(`w-${uid}`).collection('runs').doc('r1').set({ userId: uid, status: 'completed' })
  await db.collection('agents').doc(`a-${uid}`).set({ userId: uid, name: 'Agent' })
  await db.collection('tasks').doc(`t-${uid}`).set({ userId: uid, goal: 'Do a thing', status: 'done', leaseToken: 'LEASE-SECRET', leaseUntil: null })
  await db.collection('tasks').doc(`t-${uid}`).collection('events').doc('e1').set({ at: '2026-10-22T10:00:00Z', kind: 'note', text: 'hi' })
  await db.collection('devices').doc(`d-${uid}`).set({ userId: uid, name: 'Desk', tokenHash: 'TOKEN-HASH-SECRET', platform: 'win32' })
  await db.collection('devices').doc(`d-${uid}`).collection('events').doc('e1').set({ at: '2026-10-22T10:00:00Z', text: 'paired' })
  await db.collection('bridge_jobs').doc(`j-${uid}`).set({ userId: uid, deviceId: `d-${uid}`, kind: 'ping', status: 'done' })
  await db.collection('bridge_pairings').doc(`p-${uid}`).set({ userId: uid, codeHash: 'CODE-HASH-SECRET' })
  await db.collection('memories').doc(`mem-${uid}`).set({ userId: uid, text: 'Likes tea' })
  await db.collection('memory_settings').doc(uid).set({ userId: uid, enabled: false })
  await db.collection('mcp_servers').doc(`s-${uid}`).set({ userId: uid, name: 'Linear', url: 'https://mcp.example.com/x', sealedToken: 'SEALED-SECRET', approved: { mcp_linear_search: { fingerprint: 'f' } } })
  await db.collection('model_connections').doc(`${uid}__groq`).set({ userId: uid, providerId: 'groq', baseUrl: '', sealedKey: 'v1.MODEL-KEY-SECRET.x.y', models: [{ id: 'm1', label: 'M1' }], enabled: ['m1'], manual: [], fetchedAt: '2026-10-20T00:00:00.000Z', createdAt: '2026-10-20T00:00:00.000Z' })
  await db.collection('usage').doc(`${uid}__2026-10`).set({ userId: uid, total: 4, days: { '2026-10-19': 4 } })
  await db.collection('user_plans').doc(uid).set({ userId: uid, plan: 'pro', endsAt: '2099-01-01T00:00:00.000Z' })
  await db.collection('generated_files').doc(`f-${uid}`).set({ userId: uid, name: 'report.xlsx', mime: 'x', size: 3, data: Buffer.from('abc') })
  await db.collection('integrations').doc(`${uid}_slack`).set({ userId: uid, provider: 'slack' })
  await db.collection('connector_credentials').doc(`${uid}__paystack`).set({ userId: uid, provider: 'paystack', sealed: 'v1.SEALED-KEY.x.y', hint: '…abcd', connectedAt: '2026-10-01T00:00:00.000Z' })
  await db.collection('connector_usage').doc(`${uid}__arkesel__arkesel_send_sms__2026-10-19`).set({ userId: uid, count: 3 })
  await db.collection('connector_audit').doc(`au-${uid}`).set({ userId: uid, provider: 'arkesel', actionId: 'arkesel_send_sms', ok: true, units: 2 })
}
await seed('alice'); await seed('bob')

const calls: string[] = []
const deps = (over: Partial<AccountDeps> = {}): AccountDeps => ({
  db: db as any,
  listConnections: async () => [{ id: 'conn1', toolkitSlug: 'slack' }, { id: 'conn2', toolkitSlug: 'notion' }] as any,
  disconnect: async (_u, id) => { calls.push(`disconnect:${id}`); return true },
  deleteAuthUser: async (u) => { calls.push(`auth:${u}`) },
  ...over
})

// ---- Plain JSON ----
assert(plain({ at: { toDate: () => new Date('2026-01-01T00:00:00Z') }, b: Buffer.from('x'), n: [1, { d: new Date('2026-02-02T00:00:00Z') }] }).at === '2026-01-01T00:00:00.000Z', 'timestamps become ISO strings')
assert(plain({ b: Buffer.from('x') }).b === '[binary data not included]', 'binary data is left out')

// ---- Export ----
const out = await collectUserData(deps(), { id: 'alice', name: 'Alice', email: 'a@x.com' }, new Date('2026-10-19T00:00:00Z'))
assert(out.account.email === 'a@x.com' && out.exportedAt === '2026-10-19T00:00:00.000Z', 'export names the account and the date')
assert(out.chats.length === 1 && (out.chats[0] as any).messages.length === 1 && (out.chats[0] as any).votes.length === 1, 'chats come with their messages and votes')
assert((out.chats[0] as any).createdAt === '2026-01-02T03:04:05.000Z', 'chat dates are readable')
assert((out.workflows[0] as any).runs.length === 1, 'workflows come with their runs')
assert((out.tasks[0] as any).events.length === 1 && !JSON.stringify(out.tasks).includes('LEASE-SECRET'), 'tasks are exported with their logs, without lease details')
assert((out.computers[0] as any).name === 'Desk' && (out.computers[0] as any).events.length === 1 && out.computerJobs.length === 1, 'computers are exported with their logs, plus their jobs')
assert(!JSON.stringify(out).includes('TOKEN-HASH-SECRET') && !JSON.stringify(out).includes('CODE-HASH-SECRET'), 'computer tokens and pairing codes never leave in an export')
assert(out.modelProviders.length === 1 && (out.modelProviders[0] as any).provider === 'groq' && !JSON.stringify(out).includes('MODEL-KEY-SECRET'), 'connected model providers are exported without their keys')
assert(out.agents.length === 1 && out.memory.items.length === 1 && out.memory.enabled === false, 'agents and memory (including the on/off setting) are included')
assert((out.plan as any).plan === 'pro' && out.usage.length === 1, 'plan and usage are included')
assert(out.connectedApps.sort().join() === 'notion,slack', 'connected apps are listed by name')
const text = JSON.stringify(out)
assert(!text.includes('SEALED-SECRET') && !text.includes('sealedToken'), 'MCP tokens never leave in an export')
assert((out.mcpServers[0] as any).approvedTools[0] === 'mcp_linear_search', 'MCP servers are listed with their approved tools')
assert(!text.includes('SEALED-KEY') && (out.connectedKeys[0] as any).hint === '…abcd' && out.connectorActivity.length === 1, 'saved service keys are listed by their last four characters only, with what was done')
assert(!text.includes('bob') && !text.includes('hello from bob'), 'nothing of another person is exported')
assert(!('data' in (out.files[0] as any)) && (out.files[0] as any).name === 'report.xlsx', 'files are listed, not embedded')
const empty = await collectUserData(deps({ listConnections: async () => { throw new Error('down') } }), { id: 'nobody', name: 'N' })
assert(empty.chats.length === 0 && empty.plan !== undefined && empty.connectedApps.length === 0 && empty.memory.enabled === true, 'a person with nothing exports cleanly, even if the apps service is down')

// ---- Erasure: a failed disconnect deletes nothing ----
let e = await rejects(() => eraseUserData(deps({ disconnect: async () => false }), 'alice'))
assert(e instanceof AccountDeletionError && /Nothing was deleted/.test((e as Error).message), 'if an app cannot be disconnected, nothing is deleted')
assert(db.raw('chats').has('c-alice') && !calls.includes('auth:alice'), 'the data and the account are still there after that failure')
e = await rejects(() => eraseUserData(deps({ listConnections: async () => { throw new Error('down') } }), 'alice'))
assert(e instanceof AccountDeletionError && db.raw('agents').has('a-alice'), 'if the apps service cannot be reached, nothing is deleted')

// ---- Erasure ----
const res = await eraseUserData(deps(), 'alice')
assert(calls.includes('disconnect:conn1') && calls.includes('disconnect:conn2') && calls.includes('auth:alice'), 'apps are disconnected and the sign-in account removed')
for (const c of ['chats', 'workflows', 'tasks', 'devices', 'bridge_jobs', 'bridge_pairings', 'agents', 'memories', 'mcp_servers', 'model_connections', 'generated_files', 'integrations', 'connector_credentials', 'connector_usage', 'connector_audit']) {
  assert([...db.raw(c).values()].every(d => d.userId !== 'alice'), `${c}: all of Alice's documents are gone`)
}
assert(![...db.raw('usage').keys()].some(k => k.startsWith('alice')) && !db.raw('user_plans').has('alice') && !db.raw('memory_settings').has('alice'), 'usage, plan and memory settings are gone')
assert(db.raw('chats/c-alice/messages').size === 0 && db.raw('chats/c-alice/votes').size === 0 && db.raw('workflows/w-alice/runs').size === 0 && db.raw('tasks/t-alice/events').size === 0 && db.raw('devices/d-alice/events').size === 0, 'messages, votes, runs and task logs go with their parents')
assert(res.removed.chats === 1 && res.removed.agents === 1 && res.removed.connectedApps === 2, 'the result counts what was removed')

// ---- Bob is untouched ----
assert(db.raw('chats').has('c-bob') && db.raw('chats/c-bob/messages').size === 1 && db.raw('workflows/w-bob/runs').size === 1 && db.raw('user_plans').has('bob') && db.raw('generated_files').has('f-bob'), "another person's data is untouched")

// ---- Repeatable ----
const again = await eraseUserData(deps({ listConnections: async () => [] }), 'alice')
assert(again.removed.chats === 0, 'deleting again is harmless')
const authMissing = await eraseUserData(deps({ listConnections: async () => [], deleteAuthUser: async () => { throw Object.assign(new Error('gone'), { code: 'auth/user-not-found' }) } }), 'alice').then(() => 'ok', () => 'failed')
assert(authMissing === 'ok', 'an account that is already deleted counts as done')
const authBroken = await rejects(() => eraseUserData(deps({ listConnections: async () => [], deleteAuthUser: async () => { throw new Error('boom') } }), 'alice'))
assert(authBroken instanceof AccountDeletionError && /data was deleted/.test((authBroken as Error).message), 'a failed sign-in-account removal is reported honestly')
