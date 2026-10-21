import { useFirebaseDbForTests } from '../server/utils/firebaseAdmin'
import { createFakeFirestore } from './fakeFirestore'
import { BillingError, applyPayment, retryUnsentReceipts, startCheckout } from '../server/services/billing/billing'
import type { BillingDeps } from '../server/services/billing/billing'
import { failureInfoFromRun, getNotificationSettings, setNotificationSettings } from '../server/services/notifications/notify'
import { AccountDeletionError, collectUserData, eraseUserData } from '../server/services/account/account'
import { isDeleting } from '../server/services/account/tombstone'
import { saveWorkflowRun, saveChatMessages, createChat } from '../server/utils/firebase'
import { AccountDeletingError } from '../server/services/account/tombstone'
import { postApprovalCard } from '../server/utils/workflowRuns'
import { createAgent } from '../server/services/agents/store'
import { addMemory } from '../server/services/memory/store'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e } return null }

const db = createFakeFirestore()
useFirebaseDbForTests(db as any)

// ---- Billing edge cases ----
const env = { PAYSTACK_SECRET_KEY: 'sk_test_abc', PRO_PRICE_MONTH: '60', PRO_PRICE_YEAR: '600', APP_URL: 'https://openlobs.example' } as NodeJS.ProcessEnv
const paid = new Map<string, any>()
const fakeFetch = (async (url: string, init: any = {}) => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  if (url.endsWith('/transaction/initialize')) {
    const b = JSON.parse(init.body)
    paid.set(b.reference, { status: 'success', amount: b.amount, currency: b.currency, channel: 'card', reference: b.reference })
    return json(200, { status: true, data: { authorization_url: `https://checkout.paystack.com/${b.reference}`, reference: b.reference } })
  }
  const t = paid.get(decodeURIComponent(url.split('/verify/')[1]!))
  return t ? json(200, { status: true, data: t }) : json(404, { status: false, message: 'nope' })
}) as unknown as typeof fetch
const mails: any[] = []
let sendOk = true
let clock = new Date('2026-10-20T10:00:00Z')
const deps = (): BillingDeps => ({ db: db as any, paystack: { fetch: fakeFetch, secret: 'sk_test_abc' }, now: () => clock, send: async (m) => { if (!sendOk) return { sent: false }; mails.push(m); return { sent: true } }, env })
const buy = (userId: string, period: 'month' | 'year' = 'month') => startCheckout(deps(), { userId, email: `${userId}@x.com`, name: userId, period, appUrl: 'x' })

await db.collection('user_plans').doc('perm').set({ userId: 'perm', plan: 'pro', endsAt: null })
const refused = await rejects(() => buy('perm'))
assert(refused instanceof BillingError && (refused as BillingError).status === 409, 'a permanent Pro plan cannot buy more time')

// A payment started before the plan became permanent
const racing = await buy('race')
await db.collection('user_plans').doc('race').set({ userId: 'race', plan: 'pro', endsAt: null })
const raced = await applyPayment(deps(), racing.reference)
const racePlan = db.raw('user_plans').get('race')
assert(raced.status === 'refund_needed' && racePlan?.plan === 'pro' && racePlan?.endsAt === null, 'a payment never turns permanent Pro into timed Pro; it is flagged for a refund')
assert(db.raw('payments').get(racing.reference)?.status === 'refund_needed' && (await applyPayment(deps(), racing.reference)).status === 'refund_needed', 'the flag stays on the record and is repeatable')

// The account was erased between paying and confirming
const orphan = await buy('ghost')
await db.collection('payments').doc(orphan.reference).update({ userId: null, email: null, name: null })
let orphaned: any
const orphanErr = await rejects(async () => { orphaned = await applyPayment(deps(), orphan.reference) })
assert(!orphanErr && orphaned?.status === 'refund_needed' && !db.raw('user_plans').has('null'), 'a paid record with no owner is flagged, not written to a plan called null')

// Account being deleted
const doomed = await buy('doomed')
await db.collection('account_deletions').doc('doomed').set({ userId: 'doomed', startedAt: clock.toISOString() })
assert((await applyPayment(deps(), doomed.reference)).status === 'refund_needed' && !db.raw('user_plans').has('doomed'), 'no plan is written for an account that is being deleted')
assert((await rejects(() => buy('doomed'))) instanceof BillingError, 'nothing can be bought for an account that is being deleted')

// Receipts
sendOk = false
const r = await buy('rcpt')
const first = await applyPayment(deps(), r.reference)
assert(first.status === 'applied' && !db.raw('payments').get(r.reference)?.receiptSentAt && mails.length === 0, 'a receipt that did not go is not marked as sent, and Pro is active anyway')
sendOk = true
const again = await retryUnsentReceipts(deps())
assert(again.sent === 1 && mails.length === 1 && mails[0].idempotencyKey === `receipt-${r.reference}` && !!db.raw('payments').get(r.reference)?.receiptSentAt, 'the receipt is sent later, with the same idempotency key')
assert((await retryUnsentReceipts(deps())).sent === 0 && mails.length === 1, 'a receipt already sent is not sent again')

// Old payments (before receipts were tracked) are never re-sent, and a failing one backs off instead of blocking the rest
await db.collection('payments').doc('ol_old').set({ reference: 'ol_old', userId: 'o1', email: 'o1@x.com', status: 'paid', paidAt: '2026-08-01T00:00:00.000Z', months: 1, amount: 6000, currency: 'GHS', endsAt: '2026-09-01T00:00:00.000Z' })
for (const n of [1, 2, 3]) await db.collection('payments').doc(`ol_fail${n}`).set({ reference: `ol_fail${n}`, userId: `f${n}`, email: `f${n}@x.com`, status: 'paid', paidAt: `2026-10-19T0${n}:00:00.000Z`, months: 1, amount: 6000, currency: 'GHS', endsAt: '2026-11-19T00:00:00.000Z' })
mails.length = 0
sendOk = false
const roundOne = await retryUnsentReceipts(deps(), 2)
assert(roundOne.checked === 2 && roundOne.sent === 0 && !mails.some(m => /ol_old/.test(m.idempotencyKey ?? '')), 'only the batch size is tried, and a payment from before tracking is left alone')
const tried = ['ol_fail1', 'ol_fail2', 'ol_fail3'].filter(r => db.raw('payments').get(r)?.receiptAttempts === 1)
assert(tried.length === 2, 'each failed attempt is counted on its payment')
assert((await retryUnsentReceipts(deps(), 2)).checked === 1, 'payments tried a moment ago wait, so the one not yet tried gets its turn')
assert((await retryUnsentReceipts(deps(), 2)).checked === 0, 'nothing is retried again within the same day')
sendOk = true
clock = new Date('2026-10-21T08:00:00Z')
const later = await retryUnsentReceipts(deps(), 10)
assert(later.sent === 3 && ['ol_fail1', 'ol_fail2', 'ol_fail3'].every(r => !!db.raw('payments').get(r)?.receiptSentAt), 'the next day they are sent')
for (let i = 0; i < 6; i++) await db.collection('payments').doc('ol_hopeless').set({ reference: 'ol_hopeless', userId: 'h', email: 'h@x.com', status: 'paid', paidAt: '2026-10-20T00:00:00.000Z', receiptAttempts: 5, months: 1, amount: 1, currency: 'GHS', endsAt: 'x' })
assert((await retryUnsentReceipts(deps())).checked === 0, 'a payment that has failed five times is left for a person to look at')

// ---- Notifications ----
const info = failureInfoFromRun({ id: 'wf1', userId: 'u', title: 'Morning briefing' }, { logs: [{ status: 'completed', nodeTitle: 'A' }, { status: 'failed', nodeTitle: 'Fetch inbox', message: 'Not connected' }] })
assert(info.workflowName === 'Morning briefing' && info.step === 'Fetch inbox' && info.error === 'Not connected', 'the failure email uses the workflow title and the log message')
await Promise.all([setNotificationSettings(db as any, 'n1', { emailRenewals: false }), setNotificationSettings(db as any, 'n1', { emailWorkflowFailures: false })])
const ns = await getNotificationSettings(db as any, 'n1')
assert(ns.emailRenewals === false && ns.emailWorkflowFailures === false, 'two quick changes to different switches both stick')

// ---- Account export ----
await db.collection('workflows').doc('w1').set({ userId: 'x1', title: 'Flow', webhookSecret: 'WHSEC', nodes: [{ id: 'n', type: 'http', data: { config: { headers: { Authorization: 'Bearer HUSH', 'X-Plan': 'free' }, url: 'https://a.example/v1?api_key=URLKEY123&page=2' } } }] })
await db.collection('workflows').doc('w1').collection('runs').doc('r1').set({ userId: 'x1', status: 'completed', output: { fetch: { url: 'https://a.example/v1?token=RUNTOKEN9&q=hi' } } })
await db.collection('integrations').doc('x1_slack').set({ userId: 'x1', provider: 'slack', accessToken: 'LEGACY-TOKEN', status: 'connected' })
await db.collection('notification_log').doc('workflow-failed__w1__2026-10-20').set({ userId: 'x1', kind: 'workflow-failed' })
await db.collection('generated_files').doc('f1').set({ userId: 'x1', name: 'r.xlsx', size: 3, data: Buffer.from('abc') })
const calls: string[] = []
const adeps = (over: any = {}) => ({ db: db as any, listConnections: async () => [{ id: 'c1' }], disconnect: async () => { calls.push('disconnect'); return true }, deleteAuthUser: async () => { calls.push('auth') }, revokeSessions: async () => { calls.push('revoke') }, ...over })
const out = JSON.stringify(await collectUserData(adeps() as any, { id: 'x1', name: 'X' }))
assert(!out.includes('WHSEC') && !out.includes('HUSH') && out.includes('X-Plan'), 'workflow secrets and header values are not exported, header names are')
assert(!out.includes('URLKEY123') && !out.includes('RUNTOKEN9') && out.includes('page=2') && out.includes('q=hi') && out.includes('api_key=[not exported]'), 'keys in addresses are removed from settings and run records, the rest of the address stays')
assert(!out.includes('LEGACY-TOKEN') && out.includes('x1_slack') && out.includes('workflow-failed'), 'legacy app connections (without tokens) and the notification log are exported')
assert(!out.includes('"data":"') && out.includes('r.xlsx'), 'files are listed without their bytes')

// ---- Account deletion ----
const failing = await rejects(() => eraseUserData(adeps({ listConnections: async () => { throw new Error('down') } }) as any, 'x1'))
assert(failing instanceof AccountDeletionError && !(await isDeleting('x1', db)) && db.raw('workflows').has('w1'), 'if the integrations service is down, nothing is deleted and the account carries on normally')
const noRevoke = await rejects(() => eraseUserData(adeps({ revokeSessions: async () => { throw Object.assign(new Error('x'), { code: 'auth/internal-error' }) } }) as any, 'x1'))
assert(noRevoke instanceof AccountDeletionError && !(await isDeleting('x1', db)), 'if sign-ins cannot be revoked, nothing is deleted')
calls.length = 0
await eraseUserData(adeps() as any, 'x1')
assert(calls.join() === 'revoke,disconnect,auth', 'sessions are revoked first, then apps disconnected, then the sign-in account removed')
assert(await isDeleting('x1', db) && !db.raw('workflows').has('w1') && !db.raw('integrations').has('x1_slack'), 'the marker stays and the data is gone')

// A run that finishes after the marker went up writes nothing, and says so
const lateRun = await rejects(() => saveWorkflowRun('w-late', { userId: 'x1', status: 'completed', input: {}, output: {}, logs: [], durationMs: 1 } as any))
assert(lateRun instanceof AccountDeletingError && !db.raw('workflows').has('w-late') && ![...db.raw('workflows').values()].some(w => w.userId === 'x1'), 'a workflow run finishing during deletion is refused, not silently dropped')
assert((await rejects(() => postApprovalCard('x1', { id: 'w', title: 'T' } as any, { id: 'r', approvalPrompt: 'p' } as any))) instanceof AccountDeletingError && ![...db.raw('chats').values()].some(c => c.userId === 'x1'), 'no approval chat is created for an account that is being deleted')

// A reply that finishes after the sweep leaves nothing behind
await db.collection('chats').doc('c-gone').set({ userId: 'x2', title: 'live' })
assert(await saveChatMessages('c-gone', [{ id: 'm1', role: 'assistant', parts: [] }]) === true && db.raw('chats/c-gone/messages').has('m1'), 'a normal reply is saved')
await db.collection('account_deletions').doc('x2').set({ userId: 'x2', startedAt: clock.toISOString() })
assert(await saveChatMessages('c-gone', [{ id: 'm2', role: 'assistant', parts: [] }]) === false && !db.raw('chats/c-gone/messages').has('m2'), 'a reply finishing while its owner is being deleted is not saved')
assert(await saveChatMessages('c-never', [{ id: 'm3', role: 'assistant', parts: [] }]) === false && !db.raw('chats/c-never/messages').has('m3'), 'nothing is written under a chat that no longer exists')
assert((await rejects(() => createChat({ userId: 'x2', title: 'new' } as any))) instanceof AccountDeletingError && (await rejects(() => createAgent('x2', { name: 'A' } as any))) instanceof AccountDeletingError && (await rejects(() => addMemory('x2', 'likes tea', 'user' as any))) instanceof AccountDeletingError, 'new chats, agents and notes are refused for an account that is being deleted')
