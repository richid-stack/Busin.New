import { createHmac } from 'node:crypto'
import { createFakeFirestore } from './fakeFirestore'
import { BillingError, addMonths, applyPayment, billingEnabled, billingOptions, listPayments, startCheckout } from '../server/services/billing/billing'
import type { BillingDeps } from '../server/services/billing/billing'
import { verifyPaystackSignature } from '../server/services/billing/paystack'
import { emailConfig, escapeHtml, receiptEmail, renewalReminderEmail, sendEmail, workflowFailedEmail } from '../server/services/email/email'
import { DEFAULT_NOTIFICATIONS, getNotificationSettings, notifyWorkflowFailure, processRenewalReminders, setNotificationSettings } from '../server/services/notifications/notify'
import { AccountDeletionError, collectUserData, eraseUserData } from '../server/services/account/account'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e } return null }

const env = { PAYSTACK_SECRET_KEY: 'sk_test_abc', PRO_PRICE_MONTH: '60', PRO_PRICE_YEAR: '600', APP_URL: 'https://openlobs.example' } as NodeJS.ProcessEnv

// ---- Options and dates ----
assert(billingEnabled(env) && billingOptions(env).map(o => o.period).join() === 'month,year', 'both periods are on sale when priced')
assert(!billingEnabled({ ...env, PAYSTACK_SECRET_KEY: '' }) && !billingEnabled({ PAYSTACK_SECRET_KEY: 'k' }), 'no key or no price means billing is off')
assert(billingOptions({ PRO_PRICE_MONTH: '-5', PRO_PRICE_YEAR: 'abc' }).length === 0, 'bad prices are not offered')
assert(billingOptions({ PRO_PRICE_MONTH: '59.999' })[0]!.price === 60, 'prices are rounded to 2 decimals')
assert(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString() === '2026-02-28T10:00:00.000Z', '31 Jan + 1 month is the end of February')
assert(addMonths(new Date('2026-10-20T10:00:00Z'), 12).toISOString() === '2027-10-20T10:00:00.000Z', '12 months is the same date next year')
assert(addMonths(new Date('2026-11-30T00:00:00Z'), 3).toISOString() === '2027-02-28T00:00:00.000Z', 'months that are shorter clamp to their last day')

// ---- A fake Paystack ----
const db = createFakeFirestore()
const paystack = { calls: [] as Array<{ url: string, init: any }>, tx: new Map<string, any>(), failNext: false }
const fakeFetch = (async (url: string, init: any = {}) => {
  paystack.calls.push({ url, init })
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  if (paystack.failNext) { paystack.failNext = false; return json(500, { status: false, message: 'boom' }) }
  if (url.endsWith('/transaction/initialize')) {
    const b = JSON.parse(init.body)
    paystack.tx.set(b.reference, { status: 'pending', amount: b.amount, currency: b.currency, channel: 'mobile_money', reference: b.reference })
    return json(200, { status: true, data: { authorization_url: `https://checkout.paystack.com/${b.reference}`, reference: b.reference } })
  }
  const ref = decodeURIComponent(url.split('/verify/')[1]!)
  const t = paystack.tx.get(ref)
  return t ? json(200, { status: true, data: t }) : json(404, { status: false, message: 'Transaction reference not found' })
}) as unknown as typeof fetch

const sent: any[] = []
let clock = new Date('2026-10-20T10:00:00Z')
const deps = (): BillingDeps => ({ db: db as any, paystack: { fetch: fakeFetch, secret: 'sk_test_abc' }, now: () => clock, send: async (m) => { sent.push(m); return { sent: true } }, env })

// ---- Checkout ----
const co = await startCheckout(deps(), { userId: 'u1', email: 'a@x.com', name: 'Ama', period: 'month', appUrl: 'https://openlobs.example' })
const init = JSON.parse(paystack.calls[0]!.init.body)
assert(co.url.startsWith('https://checkout.paystack.com/ol_') && /^ol_[0-9a-f]{32}$/.test(co.reference), 'checkout returns the Paystack page')
assert(init.amount === 6000 && init.currency === 'GHS', 'the amount is in pesewas and in cedis')
assert(init.channels.join() === 'card,mobile_money' && init.email === 'a@x.com', 'card and mobile money are offered')
assert(init.callback_url === 'https://openlobs.example/billing/callback' && init.metadata.userId === 'u1', 'the person comes back to the app')
assert(paystack.calls[0]!.init.headers.Authorization === 'Bearer sk_test_abc', 'the secret key authorises the call')
assert(db.raw('payments').get(co.reference)?.status === 'pending' && db.raw('payments').get(co.reference)?.amount === 6000, 'the expected amount is recorded on the server first')
assert((await rejects(() => startCheckout({ ...deps(), env: {} }, { userId: 'u1', email: 'a@x.com', period: 'month', appUrl: 'x' }))) instanceof BillingError, 'checkout is refused while billing is off')
assert((await rejects(() => startCheckout(deps(), { userId: 'u1', period: 'month', appUrl: 'x' }))) instanceof BillingError, 'checkout needs an email address')
assert((await rejects(() => startCheckout({ ...deps(), env: { ...env, PRO_PRICE_YEAR: '' } }, { userId: 'u1', email: 'a@x.com', period: 'year', appUrl: 'x' }))) instanceof BillingError, 'a period that is not on sale cannot be bought')
paystack.failNext = true
const down = await rejects(() => startCheckout(deps(), { userId: 'u1', email: 'a@x.com', period: 'month', appUrl: 'x' }))
assert(down instanceof BillingError && (down as BillingError).status === 502 && !/boom|sk_test/.test((down as Error).message), 'a Paystack failure is reported without its details')

// ---- Applying a payment ----
assert((await applyPayment(deps(), co.reference)).status === 'pending', 'an unpaid payment is not applied')
assert(!db.raw('user_plans').has('u1'), 'nothing is granted before payment')
paystack.tx.get(co.reference).status = 'success'
const r1 = await applyPayment(deps(), co.reference, { requireUserId: 'u1' })
assert(r1.status === 'applied' && (r1 as any).endsAt === '2026-11-20T10:00:00.000Z', 'a paid payment gives one month from now')
const plan = db.raw('user_plans').get('u1')!
assert(plan.plan === 'pro' && plan.email === 'a@x.com' && db.raw('payments').get(co.reference)!.status === 'paid', 'the plan and the payment are recorded together')
assert(db.raw('payments').get(co.reference)!.channel === 'mobile_money', 'how it was paid is kept')
assert(sent.length === 1 && sent[0].to === 'a@x.com' && sent[0].idempotencyKey === `receipt-${co.reference}` && /Pro/.test(sent[0].subject), 'a receipt is emailed once')
const r2 = await applyPayment(deps(), co.reference)
assert(r2.status === 'already' && sent.length === 1 && db.raw('user_plans').get('u1')!.endsAt === '2026-11-20T10:00:00.000Z', 'applying twice changes nothing and sends nothing')
const concurrent = await startCheckout(deps(), { userId: 'u2', email: 'b@x.com', period: 'month', appUrl: 'x' })
paystack.tx.get(concurrent.reference).status = 'success'
const both = await Promise.all([applyPayment(deps(), concurrent.reference), applyPayment(deps(), concurrent.reference), applyPayment(deps(), concurrent.reference)])
assert(both.filter(r => r.status === 'applied').length === 1 && db.raw('user_plans').get('u2')!.endsAt === '2026-11-20T10:00:00.000Z', 'three simultaneous deliveries grant Pro once')

// ---- Stacking ----
clock = new Date('2026-11-01T00:00:00Z')
const extra = await startCheckout(deps(), { userId: 'u1', email: 'a@x.com', period: 'year', appUrl: 'x' })
paystack.tx.get(extra.reference).status = 'success'
const r3 = await applyPayment(deps(), extra.reference)
assert((r3 as any).endsAt === '2027-11-20T10:00:00.000Z', 'paying while Pro adds time to the end of what is left')
clock = new Date('2028-01-01T00:00:00Z')
const late = await startCheckout(deps(), { userId: 'u1', email: 'a@x.com', period: 'month', appUrl: 'x' })
paystack.tx.get(late.reference).status = 'success'
assert((await applyPayment(deps(), late.reference) as any).endsAt === '2028-02-01T00:00:00.000Z', 'paying after Pro ended starts from today')
clock = new Date('2026-11-01T00:00:00Z')

// ---- Forgery and mistakes ----
const cheap = await startCheckout(deps(), { userId: 'u3', email: 'c@x.com', period: 'year', appUrl: 'x' })
paystack.tx.set(cheap.reference, { status: 'success', amount: 6000, currency: 'GHS', channel: 'card', reference: cheap.reference })
const mism = await rejects(() => applyPayment(deps(), cheap.reference))
assert(mism instanceof BillingError && (mism as BillingError).status === 409 && !db.raw('user_plans').has('u3'), 'paying the monthly price for the yearly plan grants nothing')
assert(db.raw('payments').get(cheap.reference)!.status === 'mismatch', 'the mismatch is recorded')
const wrongCur = await startCheckout(deps(), { userId: 'u4', email: 'd@x.com', period: 'month', appUrl: 'x' })
paystack.tx.set(wrongCur.reference, { status: 'success', amount: 6000, currency: 'USD', channel: 'card', reference: wrongCur.reference })
assert((await rejects(() => applyPayment(deps(), wrongCur.reference))) instanceof BillingError && !db.raw('user_plans').has('u4'), 'a different currency grants nothing')
assert((await rejects(() => applyPayment(deps(), 'ol_' + 'a'.repeat(32)))) instanceof BillingError, 'an unknown reference is refused')
assert((await rejects(() => applyPayment(deps(), '../etc/passwd'))) instanceof BillingError, 'a malformed reference is refused')
const mine = await startCheckout(deps(), { userId: 'u5', email: 'e@x.com', period: 'month', appUrl: 'x' })
paystack.tx.get(mine.reference).status = 'success'
const stolen = await rejects(() => applyPayment(deps(), mine.reference, { requireUserId: 'u1' }))
assert(stolen instanceof BillingError && (stolen as BillingError).status === 404 && !db.raw('user_plans').has('u5'), "someone else's reference cannot be used, and looks like an unknown one")
paystack.tx.get(mine.reference).status = 'abandoned'
assert((await applyPayment(deps(), mine.reference)).status === 'failed', 'an abandoned payment reads as failed')

// ---- Signatures ----
const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ol_x' } })
const sig = createHmac('sha512', 'sk_test_abc').update(body).digest('hex')
assert(verifyPaystackSignature(body, sig, 'sk_test_abc'), 'a correct signature is accepted')
assert(!verifyPaystackSignature(body + ' ', sig, 'sk_test_abc') && !verifyPaystackSignature(body, sig, 'other') && !verifyPaystackSignature(body, undefined, 'sk_test_abc') && !verifyPaystackSignature(body, 'abc', 'sk_test_abc') && !verifyPaystackSignature(body, sig, ''), 'a changed body, wrong key, missing or short signature is refused')
assert(verifyPaystackSignature(body, sig.toUpperCase(), 'sk_test_abc'), 'signature case does not matter')

// ---- Payment history ----
const hist = await listPayments(deps(), 'u1')
assert(hist.length === 3 && hist[0]!.paidAt >= hist[1]!.paidAt && !('email' in hist[0]!), 'only paid payments are listed, newest first, without personal details')
assert((await listPayments(deps(), 'nobody')).length === 0, 'someone with no payments sees none')

// ---- Email ----
const calls: any[] = []
const mailFetch = (async (url: string, init: any) => { calls.push({ url, init }); return new Response('{}', { status: 200 }) }) as unknown as typeof fetch
assert((await sendEmail({ to: 'a@x.com', subject: 's', html: 'h', text: 't' }, { config: null })).sent === false, 'without configuration nothing is sent')
assert(emailConfig({}) === null && emailConfig({ RESEND_API_KEY: 'k', EMAIL_FROM: 'OpenLobs <hi@x.com>' })?.from === 'OpenLobs <hi@x.com>', 'email needs both a key and a sender')
const ok = await sendEmail({ to: 'a@x.com', subject: 'Hi', html: '<p>x</p>', text: 'x', idempotencyKey: 'k1' }, { fetch: mailFetch, config: { apiKey: 'rk', from: 'OpenLobs <hi@x.com>' } })
const sentBody = JSON.parse(calls[0].init.body)
assert(ok.sent && calls[0].url === 'https://api.resend.com/emails' && calls[0].init.headers.Authorization === 'Bearer rk' && calls[0].init.headers['Idempotency-Key'] === 'k1', 'Resend is called with the key and an idempotency key')
assert(sentBody.to[0] === 'a@x.com' && sentBody.from === 'OpenLobs <hi@x.com>', 'the right sender and recipient')
assert((await sendEmail({ to: 'not an email', subject: 's', html: 'h', text: 't' }, { fetch: mailFetch, config: { apiKey: 'k', from: 'f' } })).sent === false && calls.length === 1, 'a bad address is not sent to')
const refused = await sendEmail({ to: 'a@x.com', subject: 's', html: 'h', text: 't' }, { fetch: (async () => new Response('{"message":"bad"}', { status: 422 })) as unknown as typeof fetch, config: { apiKey: 'k', from: 'f' } })
assert(refused.sent === false, 'a refused email reports not sent')
const dead = await sendEmail({ to: 'a@x.com', subject: 's', html: 'h', text: 't' }, { fetch: (async () => { throw new Error('network') }) as unknown as typeof fetch, config: { apiKey: 'k', from: 'f' } })
assert(dead.sent === false, 'a network failure never throws')
assert(escapeHtml('<script>"&\'') === '&lt;script&gt;&quot;&amp;&#39;', 'html is escaped')
const evil = workflowFailedEmail({ workflowName: '<img src=x onerror=1>', error: '<b>bad</b>', step: 'S&T' })
assert(!evil.html.includes('<img src=x') && !evil.html.includes('<b>bad</b>') && evil.html.includes('S&amp;T'), 'names and errors cannot inject html into an email')
assert(/GHS 60\.00/.test(receiptEmail({ months: 1, amountMinor: 6000, currency: 'GHS', reference: 'r', endsAt: '2026-11-20T10:00:00Z' }).text), 'the receipt shows the amount')
assert(/20 November 2026/.test(renewalReminderEmail({ endsAt: '2026-11-20T10:00:00Z' }).text), 'the reminder names the date')

// ---- Notification settings ----
assert(JSON.stringify(await getNotificationSettings(db as any, 'n1')) === JSON.stringify(DEFAULT_NOTIFICATIONS), 'notifications are on by default')
await setNotificationSettings(db as any, 'n1', { emailRenewals: false })
const ns = await getNotificationSettings(db as any, 'n1')
assert(ns.emailRenewals === false && ns.emailWorkflowFailures === true, 'a setting changes alone')

// ---- Renewal reminders ----
const mails: any[] = []
const nd = (now: Date) => ({ db: db as any, now: () => now, send: async (m: any) => { mails.push(m); return { sent: true } }, contact: async (id: string) => ({ email: `${id}@x.com`, name: id }), appUrl: 'https://openlobs.example' })
const remDb = createFakeFirestore()
const nr = (now: Date) => ({ ...nd(now), db: remDb as any })
await remDb.collection('user_plans').doc('soon').set({ userId: 'soon', plan: 'pro', endsAt: '2026-10-22T00:00:00.000Z', email: 'soon@x.com' })
await remDb.collection('user_plans').doc('later').set({ userId: 'later', plan: 'pro', endsAt: '2027-01-01T00:00:00.000Z', email: 'later@x.com' })
await remDb.collection('user_plans').doc('gone').set({ userId: 'gone', plan: 'pro', endsAt: '2026-10-01T00:00:00.000Z', email: 'gone@x.com' })
await remDb.collection('user_plans').doc('off').set({ userId: 'off', plan: 'pro', endsAt: '2026-10-21T00:00:00.000Z', email: 'off@x.com' })
await remDb.collection('user_settings').doc('off').set({ userId: 'off', emailRenewals: false })
await remDb.collection('user_plans').doc('free1').set({ userId: 'free1', plan: 'free', endsAt: '2026-10-21T00:00:00.000Z' })
const day1 = new Date('2026-10-20T08:00:00Z')
const rs = await processRenewalReminders(nr(day1))
assert(mails.length === 1 && mails[0].to === 'soon@x.com' && /ends soon/.test(mails[0].subject), 'only the plan ending within 3 days gets a reminder')
assert(rs.sent === 1 && rs.checked === 3, 'plans far away or already ended are not even read')
await processRenewalReminders(nr(new Date('2026-10-20T20:00:00Z')))
assert(mails.length === 1, 'the same plan end date is reminded only once')
await remDb.collection('user_plans').doc('soon').update({ endsAt: '2026-11-22T00:00:00.000Z' })
assert((await processRenewalReminders(nr(new Date('2026-11-20T08:00:00Z')))).sent === 1 && mails.length === 2, 'after extending and nearing the new end, a new reminder goes out')

// ---- Workflow failure emails ----
const wd = nd(new Date('2026-10-20T08:00:00Z'))
const fail = { userId: 'w1', workflowId: 'wf1', workflowName: 'Morning briefing', step: 'Fetch inbox', error: 'Not connected' }
mails.length = 0
assert(await notifyWorkflowFailure(wd, fail) === true && mails.length === 1 && /Morning briefing/.test(mails[0].subject), 'a failed scheduled run emails its owner')
assert(await notifyWorkflowFailure(wd, fail) === false && mails.length === 1, 'only one email per workflow per day')
assert(await notifyWorkflowFailure({ ...wd, now: () => new Date('2026-10-21T08:00:00Z') }, fail) === true, 'the next day it can email again')
await setNotificationSettings(db as any, 'w2', { emailWorkflowFailures: false })
assert(await notifyWorkflowFailure(wd, { ...fail, userId: 'w2', workflowId: 'wf2' }) === false, 'switched off means no email')
assert(await notifyWorkflowFailure({ ...wd, contact: async () => null }, { ...fail, workflowId: 'wf3' }) === false, 'no address means no email')
assert(await notifyWorkflowFailure({ ...wd, send: async () => ({ sent: false }) }, { ...fail, workflowId: 'wf4' }) === false && !db.raw('notification_log').has('workflow-failed__wf4__2026-10-20'), 'a failed send is not logged, so it can be tried again')

// ---- Account export and deletion include payments ----
const adeps = { db: db as any, listConnections: async () => [], disconnect: async () => true, deleteAuthUser: async () => {} }
const exp = await collectUserData(adeps as any, { id: 'u1', name: 'Ama', email: 'a@x.com' })
assert(exp.payments.length >= 3 && (exp.payments as any[]).filter(p => p.status === 'paid').length === 3 && (exp.notifications as any).emailRenewals !== undefined, 'the export includes payments and notification settings')
await db.collection('user_settings').doc('u1').set({ userId: 'u1', emailRenewals: false })
await eraseUserData(adeps as any, 'u1')
const kept = [...db.raw('payments').values()].filter(p => p.reference === co.reference)[0]!
assert(kept.userId === null && kept.email === null && kept.name === null && kept.amount === 6000 && kept.reference === co.reference && !!kept.anonymisedAt, 'payment records are kept for the books but no longer name the person')
assert(!db.raw('user_plans').has('u1') && !db.raw('user_settings').has('u1'), 'the plan and notification settings are deleted')
assert([...db.raw('payments').values()].filter(p => p.userId === 'u2').length === 1, "another person's payments are untouched")
assert(!(await rejects(() => eraseUserData(adeps as any, 'u1'))), 'deleting again is harmless')
void AccountDeletionError
