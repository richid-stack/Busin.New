import { useFirebaseDbForTests } from '../server/utils/firebaseAdmin'
import { createFakeFirestore } from './fakeFirestore'
import { dayKey, modelCost, monthKey, nextDayStart, nextMonthStart, planLimits } from '../server/services/usage/plans'
import { trackToolWork } from '../server/services/integrations/execute'
import { UsageLimitError, chargeGuest, chargeUsage, consumeCredits, getPlan, getUsage, recordTokens, refundCredits, setPlan } from '../server/services/usage/usage'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const limitError = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e instanceof UsageLimitError ? e : null } return null }

for (const k of Object.keys(process.env)) if (k.startsWith('USAGE_')) delete process.env[k]

// ---- Plans and dates ----
assert(planLimits('guest').daily === 5 && planLimits('free').daily === 30 && planLimits('pro').monthly === 5000, 'default plan limits')
process.env.USAGE_FREE_DAILY = '7'
assert(planLimits('free').daily === 7, 'limits can be set from the environment')
process.env.USAGE_FREE_DAILY = 'nonsense'
assert(planLimits('free').daily === 30, 'a bad environment value falls back to the default')
process.env.USAGE_FREE_DAILY = ''
assert(planLimits('free').daily === 30, 'a blank environment value means the default, not zero')
process.env.USAGE_FREE_DAILY = '   '
assert(planLimits('free').monthly === 400 && planLimits('free').daily === 30, 'a whitespace-only value means the default')
delete process.env.USAGE_FREE_DAILY
assert(modelCost('anthropic/claude-haiku-4.5') === 3 && modelCost('something/else') === 1 && modelCost(null) === 1, 'model costs, default 1')
const t = new Date('2026-10-19T23:59:00Z')
assert(dayKey(t) === '2026-10-19' && monthKey(t) === '2026-10', 'day and month keys are UTC')
assert(nextDayStart(t).toISOString() === '2026-10-20T00:00:00.000Z', 'daily reset is the next UTC midnight')
assert(nextMonthStart(new Date('2026-12-31T10:00:00Z')).toISOString() === '2027-01-01T00:00:00.000Z', 'monthly reset rolls over the year')

// ---- Counting against the store ----
const db = createFakeFirestore()
useFirebaseDbForTests(db as any)
const day1 = new Date('2026-10-19T10:00:00Z')

await consumeCredits('u1', 'guest', 3, day1)
await consumeCredits('u1', 'guest', 2, day1)
let err = await limitError(() => consumeCredits('u1', 'guest', 1, day1))
assert(err?.reason === 'daily', 'the sixth guest credit is refused')
assert(!!err && /daily limit of 5 credits/.test(err.message) && /midnight/.test(err.message), 'the message says which limit and when it resets')
assert((await getUsage('u1', day1)).usedToday === 5, 'a refused call takes nothing')

err = await limitError(() => consumeCredits('u1', 'free', 40, day1))
assert(err?.reason === 'daily', 'one call bigger than what is left is refused whole')

// ---- Next day, monthly cap ----
const day2 = new Date('2026-10-20T10:00:00Z')
process.env.USAGE_FREE_DAILY = '10'
process.env.USAGE_FREE_MONTHLY = '12'
await consumeCredits('u2', 'free', 10, day1)
await consumeCredits('u2', 'free', 2, day2)
err = await limitError(() => consumeCredits('u2', 'free', 1, day2))
assert(err?.reason === 'monthly' && /resets on 1 November/.test(err.message), 'the monthly cap stops a new day, and says when it resets')
assert(err !== null && /upgrade/i.test(err.message), 'free plan is pointed at upgrading')
const nextMonth = new Date('2026-11-02T10:00:00Z')
await consumeCredits('u2', 'free', 1, nextMonth)
assert((await getUsage('u2', nextMonth)).usedMonth === 1, 'a new month starts from zero')
delete process.env.USAGE_FREE_DAILY
delete process.env.USAGE_FREE_MONTHLY

// ---- Refunds ----
await refundCredits('u1', 3, day1)
assert((await getUsage('u1', day1)).usedToday === 2 && (await getUsage('u1', day1)).usedMonth === 2, 'a refund gives credits back')
await refundCredits('u1', 99, day1)
assert((await getUsage('u1', day1)).usedToday === 0, 'a refund never goes below zero')
await refundCredits('nobody', 1, day1)
assert(true, 'refunding a person with no usage is harmless')

// ---- Concurrency: 12 requests at once against a limit of 5 ----
const results = await Promise.all(Array.from({ length: 12 }, () => consumeCredits('u3', 'guest', 1, day1).then(() => 'ok', e => (e instanceof UsageLimitError ? 'limited' : 'error'))))
assert(results.filter(r => r === 'ok').length === 5 && results.filter(r => r === 'limited').length === 7, 'simultaneous requests cannot slip past the limit')

// ---- Plans ----
assert((await getPlan('p1')).plan === 'free', 'no plan record means free')
await setPlan('p1', 'pro', '2099-01-01T00:00:00.000Z')
assert((await getPlan('p1')).plan === 'pro', 'a current pro plan is pro')
await setPlan('p2', 'pro', '2020-01-01T00:00:00.000Z')
assert((await getPlan('p2')).plan === 'free', 'an expired pro plan counts as free')
assert((await getUsage('p1')).limits.daily === 300, 'the usage snapshot carries the plan limits')

// ---- Tokens ----
await consumeCredits('t1', 'free', 1, day1)
await recordTokens('t1', 120, 80, day1)
await recordTokens('t1', 10, 5, day1)
const tok = (await getUsage('t1', day1)).tokens
assert(tok.input === 130 && tok.output === 85, 'token totals add up')
await recordTokens('t-none', 5, 5, day1)
assert((await getUsage('t-none', day1)).tokens.input === 0, 'tokens for someone with no usage record are ignored, not invented')

// ---- chargeUsage: the call the app uses ----
const guestSpend: Array<Awaited<ReturnType<typeof chargeUsage>>> = []
for (let i = 0; i < 5; i++) guestSpend.push(await chargeUsage('g1', 1, { guest: true }))
assert(!!(await limitError(() => chargeUsage('g1', 1, { guest: true }))), 'guests stop at 5')
await guestSpend[0]!.refund()
await chargeUsage('g1', 1, { guest: true })
assert(true, 'a refund frees a slot')
assert((await chargeUsage('g1', 0, { guest: true })).refund !== undefined, 'zero cost is a no-op')

process.env.USAGE_UNLIMITED_USER_IDS = 'owner, tester'
for (let i = 0; i < 400; i++) await chargeUsage('owner', 3)
assert((await getUsage('owner')).usedMonth === 0 && (await getUsage('owner')).unlimited, 'listed owners are never limited or counted')
delete process.env.USAGE_UNLIMITED_USER_IDS

// ---- Storage trouble must not lock people out, but a real limit must still stop them ----
const broken = { collection: () => { throw new Error('firestore down') }, runTransaction: async () => { throw new Error('firestore down') } }
useFirebaseDbForTests(broken as any)
const warn = console.warn; console.warn = () => {}
const open = await chargeUsage('x', 1).then(() => 'allowed', () => 'blocked')
console.warn = warn
assert(open === 'allowed', 'a storage outage lets the request through')
useFirebaseDbForTests(db as any)
assert(!!(await limitError(() => chargeUsage('g1', 5, { guest: true }))), 'a limit still stops people once storage is back')

// ---- A refund goes back to the day the charge was taken ----
{
  const charged = await chargeUsage('refund-user', 2)
  const before = (await getUsage('refund-user')).usedToday
  await charged.refund()
  const after = (await getUsage('refund-user')).usedToday
  assert(before === 2 && after === 0, 'a refund returns the credits that were charged')
  const past = new Date('2026-01-31T23:59:59Z')
  await consumeCredits('late-user', 'free', 4, past)
  await refundCredits('late-user', 4, past)
  assert((await getUsage('late-user', past)).usedToday === 0 && (await getUsage('late-user', new Date('2026-02-01T00:00:01Z'))).usedToday === 0, 'a refund for last month’s charge does not touch the new month')
}

// ---- Guests: their own session and a larger shared address ceiling ----
{
  for (let i = 0; i < 5; i++) await chargeGuest('sess-a', 'ip_1.2.3.4', 1)
  const blocked = await limitError(() => chargeGuest('sess-a', 'ip_1.2.3.4', 1))
  assert(blocked?.reason === 'daily', 'a guest session is limited to its own small allowance')
  const freshCookie = await limitError(() => chargeGuest('sess-b', 'ip_1.2.3.4', 1))
  assert(freshCookie === null, 'another person on the same address still gets their own allowance')
  for (let i = 0; i < 60; i++) { await chargeGuest(`s${i}`, 'ip_9.9.9.9', 1).catch(() => {}) }
  const shared = await limitError(() => chargeGuest('sess-new', 'ip_9.9.9.9', 1))
  assert(shared?.reason === 'daily', 'one address cannot use unlimited guest allowance by clearing cookies')
  const refundedAfter = await chargeGuest('sess-r', 'ip_5.5.5.5', 1)
  await refundedAfter.refund()
  assert((await db.collection('usage').where('userId', '==', 'guest-sess-r').get()).docs[0]?.data().total === 0 && (await db.collection('usage').where('userId', '==', 'guest-addr-ip_5.5.5.5').get()).docs[0]?.data().total === 0, 'a refund returns both charges')
}

// ---- Tool work is tracked, so a refund cannot follow completed work ----
{
  let ran = 0
  const t = trackToolWork({ send: { description: 'x', execute: async () => { ran++; return 'ok' } }, plain: { description: 'no execute' } as any })
  assert(t.worked() === false, 'nothing has run yet')
  await t.tools.send.execute()
  assert(ran === 1 && t.worked() === true, 'once a tool has started the run counts as having done work')
  assert('plain' in t.tools, 'tools without an execute function pass through')
}
