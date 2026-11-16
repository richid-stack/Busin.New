import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { useFirebaseDbForTests } from '../server/utils/firebaseAdmin'

// These checks run against the real Firestore emulator (Google's own program), not the in-memory stand-in the other
// tests use. The stand-in proves the store logic; this proves the parts only the real thing can: transactions that
// retry under contention, documents that must not hold `undefined`, and the limits holding when requests overlap.
// They run in CI (see .github/workflows/real-checks.yml). Without the emulator running they skip.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('SKIP the Firestore emulator is not running (FIRESTORE_EMULATOR_HOST is not set). These checks run in CI.')
  process.exit(0)
}

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const app = initializeApp({ projectId: 'demo-openlobs' }, 'emulator-test')
const db = getFirestore(app)
useFirebaseDbForTests(db)

const { chargeUsage, getUsage, UsageLimitError } = await import('../server/services/usage/usage')
const { createAddToolServerTool, addablePresets } = await import('../server/utils/tools/addToolServer')
const { createRunInCloudTool } = await import('../server/utils/tools/runInCloud')
const { createServer, listServers } = await import('../server/services/mcp/store')
const { MCP_LIMITS } = await import('../server/services/mcp/tools')
const { InspectError } = await import('../server/services/inspect/browser')

const stamp = Date.now()
let n = 0
const uid = (label: string) => `emu-${label}-${stamp}-${++n}`

// ---- Credits: the limit holds, and refunds go back ----
{
  const u = uid('credits')
  await chargeUsage(u, 5)
  assert((await getUsage(u)).usedToday === 5, 'a charge is written to the real database')
  const big = await chargeUsage(u, 25)
  assert((await getUsage(u)).usedToday === 30, 'up to the daily limit it is allowed')
  const over = await chargeUsage(u, 1).then(() => null, e => e)
  assert(over instanceof UsageLimitError && over.reason === 'daily', 'one more is refused with the daily limit')
  assert((await getUsage(u)).usedToday === 30, 'a refused charge takes nothing')
  await big.refund()
  assert((await getUsage(u)).usedToday === 5, 'a refund gives the credits back')
}
{
  // Ten requests at once for six plans' worth of credits: the real transaction has to let exactly six through.
  const u = uid('race')
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => chargeUsage(u, 5)))
  const won = results.filter(r => r.status === 'fulfilled').length
  assert(won === 6 && (await getUsage(u)).usedToday === 30, `ten overlapping charges of 5 against a limit of 30: ${won} got through and the total is ${(await getUsage(u)).usedToday}`)
}

// ---- Adding a tool server, through the real store ----
const found = [{ name: 'search', description: 'Search', inputSchema: { type: 'object', properties: {} } }]
const preset = addablePresets()[0]!
{
  const u = uid('add')
  const tool: any = createAddToolServerTool(u, { list: (async () => found) as any })
  const first: any = await tool.execute({ server: preset.name, why: 'Needed for the job' }, {})
  assert(first.status === 'added', 'a server is added through the real store')
  const mine = await listServers(u)
  assert(mine.length === 1 && mine[0]!.url === preset.url && Object.keys(mine[0]!.approved).length === 0, 'it is saved with no tool switched on')
  const second: any = await createAddToolServerTool(u, { list: (async () => found) as any }).execute!({ server: preset.name, why: 'Again' }, {} as any)
  assert((second as any).status === 'already_added' && (await listServers(u)).length === 1, 'asking again does not add it twice')
}
{
  // Two adds of the same server at the same moment: the real transaction keeps exactly one.
  const u = uid('addrace')
  const a: any = createAddToolServerTool(u, { list: (async () => found) as any, servers: async () => [] })
  const b: any = createAddToolServerTool(u, { list: (async () => found) as any, servers: async () => [] })
  const both = await Promise.all([a.execute({ server: preset.name, why: 'One' }, {}), b.execute({ server: preset.name, why: 'Two' }, {})])
  assert((await listServers(u)).length === 1 && both.filter((r: any) => r.status === 'added').length === 1, 'two adds at once leave exactly one saved')
}
{
  const u = uid('addlimit')
  for (let i = 0; i < MCP_LIMITS.maxServersPerUser; i++) await createServer(u, { name: `S${i}`, url: `https://example.com/mcp/${i}`, headerName: '', sealedToken: '' })
  const r: any = await createAddToolServerTool(u, { list: (async () => found) as any, servers: async () => [] }).execute!({ server: preset.name, why: 'Full' }, {} as any)
  assert(r.status === 'failed' && /up to/.test(r.error) && (await listServers(u)).length === MCP_LIMITS.maxServersPerUser, 'at the limit the real store refuses and the tool says so')
}

// ---- A plan in the cloud: credits are taken, and given back when the box was never reached ----
{
  const u = uid('cloud')
  const ok = createRunInCloudTool(u, { box: { name: 'x', run: async () => ({ steps: [{ n: 1, exitCode: 0, timedOut: false, ms: 5, output: 'hi', outputTruncated: false }] }) } })
  const done: any = await (ok.execute as any)({ why: 'Say hi', steps: [{ program: 'node', args: ['--version'] }], files: [] }, {})
  assert(done.status === 'ok' && (await getUsage(u)).usedToday === 5, 'a plan that ran costs its credits in the real database')
  const down = createRunInCloudTool(u, { box: { name: 'x', run: async () => { throw new InspectError('The cloud box could not be reached.') } } })
  const lost: any = await (down.execute as any)({ why: 'Say hi', steps: [{ program: 'node', args: ['--version'] }], files: [] }, {})
  assert(lost.status === 'failed' && (await getUsage(u)).usedToday === 5, 'a plan that never reached the box is refunded')
}
