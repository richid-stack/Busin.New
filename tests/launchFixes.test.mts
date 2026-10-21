import { useFirebaseDbForTests } from '../server/utils/firebaseAdmin'
import { createFakeFirestore } from './fakeFirestore'
import { BillingError, applyPayment, retryUnsentReceipts, startCheckout } from '../server/services/billing/billing'
import type { BillingDeps } from '../server/services/billing/billing'
import { failureInfoFromRun, getNotificationSettings, setNotificationSettings } from '../server/services/notifications/notify'
import { AccountDeletionError, collectUserData, eraseUserData } from '../server/services/account/account'
import { isDeleting } from '../server/services/account/tombstone'
import { saveWorkflowRun } from '../server/utils/firebase'

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
const clock = new Date('2026-10-20T10:00:00Z')
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

// ---- Notifications ----
const info = failureInfoFromRun({ id: 'wf1', userId: 'u', title: 'Morning briefing' }, { logs: [{ status: 'completed', nodeTitle: 'A' }, { status: 'failed', nodeTitle: 'Fetch inbox', message: 'Not connected' }] })
assert(info.workflowName === 'Morning briefing' && info.step === 'Fetch inbox' && info.error === 'Not connected', 'the failure email uses the workflow title and the log message')
await Promise.all([setNotificationSettings(db as any, 'n1', { emailRenewals: false }), setNotificationSettings(db as any, 'n1', { emailWorkflowFailures: false })])
const ns = await getNotificationSettings(db as any, 'n1')
assert(ns.emailRenewals === false && ns.emailWorkflowFailures === false, 'two quick changes to different switches both stick')

// ---- Account export ----
await db.collection('workflows').doc('w1').set({ userId: 'x1', title: 'Flow', webhookSecret: 'WHSEC', nodes: [{ id: 'n', type: 'http', data: { config: { headers: { Authorization: 'Bearer HUSH', 'X-Plan': 'free' }, url: 'https://a.example' } } }] })
await db.collection('integrations').doc('x1_slack').set({ userId: 'x1', provider: 'slack', accessToken: 'LEGACY-TOKEN', status: 'connected' })
await db.collection('notification_log').doc('workflow-failed__w1__2026-10-20').set({ userId: 'x1', kind: 'workflow-failed' })
await db.collection('generated_files').doc('f1').set({ userId: 'x1', name: 'r.xlsx', size: 3, data: Buffer.from('abc') })
const calls: string[] = []
const adeps = (over: any = {}) => ({ db: db as any, listConnections: async () => [{ id: 'c1' }], disconnect: async () => { calls.push('disconnect'); return true }, deleteAuthUser: async () => { calls.push('auth') }, revokeSessions: async () => { calls.push('revoke') }, ...over })
const out = JSON.stringify(await collectUserData(adeps() as any, { id: 'x1', name: 'X' }))
assert(!out.includes('WHSEC') && !out.includes('HUSH') && out.includes('X-Plan'), 'workflow secrets and header values are not exported, header names are')
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

// A run that finishes after the marker went up writes nothing
await saveWorkflowRun('w-late', { userId: 'x1', status: 'completed', input: {}, output: {}, logs: [], durationMs: 1 } as any)
assert(!db.raw('workflows').has('w-late') && ![...db.raw('workflows').values()].some(w => w.userId === 'x1'), 'a workflow run finishing during deletion is not saved')
