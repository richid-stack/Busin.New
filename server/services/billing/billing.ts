import { randomUUID } from 'node:crypto'
import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { receiptEmail, sendEmail } from '../email/email'
import type { EmailMessage } from '../email/email'
import { isDeleting, DELETIONS } from '../account/tombstone'
import { paystackInitialize, paystackVerify, PaystackError } from './paystack'
import type { PaystackDeps } from './paystack'

/**
 * Pro is sold as prepaid periods: the person pays once (card or mobile money) for 1 or 12 months, and
 * Pro runs until the end of what they paid for. Mobile money in Ghana needs the person to approve each
 * payment on their phone, so automatic renewal is not offered; a reminder email is sent instead.
 */
const PAYMENTS = 'payments'
const PLANS = 'user_plans'

export class BillingError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export type Period = 'month' | 'year'

export interface BillingOption { period: Period, months: number, label: string, /** In whole cedis (or the configured currency). */ price: number }

export const billingCurrency = (env: NodeJS.ProcessEnv = process.env) => (env.PAYSTACK_CURRENCY || 'GHS').toUpperCase()

const price = (v: string | undefined) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : 0
}

/** Which periods are on sale. A period with no price set is simply not offered. */
export function billingOptions(env: NodeJS.ProcessEnv = process.env): BillingOption[] {
  const out: BillingOption[] = []
  const month = price(env.PRO_PRICE_MONTH)
  const year = price(env.PRO_PRICE_YEAR)
  if (month) out.push({ period: 'month', months: 1, label: '1 month', price: month })
  if (year) out.push({ period: 'year', months: 12, label: '12 months', price: year })
  return out
}

export const billingEnabled = (env: NodeJS.ProcessEnv = process.env) => Boolean((env.PAYSTACK_SECRET_KEY || '').trim()) && billingOptions(env).length > 0

/** Same day next month(s), or the last day of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}

export interface BillingDeps {
  db: any
  paystack: PaystackDeps
  now: () => Date
  send: (msg: EmailMessage) => Promise<{ sent: boolean }>
  env: NodeJS.ProcessEnv
}

export const defaultBillingDeps = (): BillingDeps => ({
  db: getFirebaseDb(),
  paystack: {},
  now: () => new Date(),
  send: msg => sendEmail(msg),
  env: process.env
})

export async function startCheckout(deps: BillingDeps, input: { userId: string, email?: string, name?: string, period: Period, appUrl: string }): Promise<{ url: string, reference: string }> {
  if (!billingEnabled(deps.env)) throw new BillingError('Paid plans are not open yet.', 503)
  const option = billingOptions(deps.env).find(o => o.period === input.period)
  if (!option) throw new BillingError('That plan is not available.', 400)
  if (!input.email) throw new BillingError('Your account has no email address, which payments need. Sign in with an account that has one.', 400)

  const planSnap = await deps.db.collection(PLANS).doc(input.userId).get()
  const existing = planSnap.exists ? planSnap.data() : null
  if (existing?.plan === 'pro' && !existing.endsAt) throw new BillingError('Your Pro plan has no end date, so there is nothing to buy.', 409)
  if (await isDeleting(input.userId, deps.db)) throw new BillingError('This account is being deleted.', 409)

  const reference = `ol_${randomUUID().replace(/-/g, '')}`
  const currency = billingCurrency(deps.env)
  const amount = Math.round(option.price * 100)

  // The amount is fixed here, on the server, before the person is sent anywhere. What they actually
  // paid is later compared with this record, never with anything the browser says.
  await deps.db.collection(PAYMENTS).doc(reference).set({
    reference, userId: input.userId, email: input.email, name: input.name ?? '', period: option.period, months: option.months,
    amount, currency, status: 'pending', createdAt: deps.now().toISOString()
  })

  const { authorizationUrl } = await paystackInitialize({
    email: input.email,
    amount,
    currency,
    reference,
    callbackUrl: `${input.appUrl}/billing/callback`,
    channels: ['card', 'mobile_money'],
    metadata: { userId: input.userId, months: option.months, product: 'openlobs-pro' }
  }, deps.paystack).catch((err) => {
    throw err instanceof PaystackError ? new BillingError(err.message, 502) : err
  })
  return { url: authorizationUrl, reference }
}

export type ApplyResult =
  | { status: 'applied', endsAt: string }
  | { status: 'already', endsAt: string }
  | { status: 'pending' }
  | { status: 'failed' }
  /** Paid, but there is no account (or no change to make) to give it to. Recorded for a manual refund. */
  | { status: 'refund_needed' }

/**
 * Turns a payment into Pro time. Safe to call any number of times and from both the person's return
 * visit and Paystack's webhook: whichever arrives first applies it, the rest see "already".
 */
export async function applyPayment(deps: BillingDeps, reference: string, opts: { requireUserId?: string } = {}): Promise<ApplyResult> {
  if (!/^ol_[0-9a-f]{32}$/.test(reference)) throw new BillingError('Unknown payment.', 404)
  const ref = deps.db.collection(PAYMENTS).doc(reference)
  const snap = await ref.get()
  const payment = snap.exists ? snap.data() : null
  // The same answer for "no such payment" and "someone else's", so references cannot be probed.
  if (!payment || (opts.requireUserId && payment.userId !== opts.requireUserId)) throw new BillingError('Unknown payment.', 404)
  if (payment.status === 'paid') return { status: 'already', endsAt: String(payment.endsAt) }
  if (payment.status === 'refund_needed') return { status: 'refund_needed' }
  // The account was erased after this payment was started: the record has no owner any more.
  if (!payment.userId) return await flagForRefund(deps, ref, payment, 'account erased')

  let verified
  try {
    verified = await paystackVerify(reference, deps.paystack)
  } catch (err) {
    throw err instanceof PaystackError ? new BillingError(err.message, 502) : err
  }
  if (verified.status !== 'success') {
    return { status: ['failed', 'abandoned', 'reversed'].includes(verified.status) ? 'failed' : 'pending' }
  }
  if (verified.amount !== payment.amount || verified.currency !== payment.currency) {
    await ref.update({ status: 'mismatch', checkedAt: deps.now().toISOString() }).catch(() => {})
    console.warn(`[billing] Payment ${reference} did not match what was asked for. Not applied.`)
    throw new BillingError('That payment does not match the plan that was chosen. Nothing was applied; please contact us.', 409)
  }

  const now = deps.now()
  if (await isDeleting(payment.userId, deps.db)) return await flagForRefund(deps, ref, payment, 'account being deleted')
  const planRef = deps.db.collection(PLANS).doc(payment.userId)
  const deletionRef = deps.db.collection(DELETIONS).doc(payment.userId)
  const state: { outcome: ApplyResult } = { outcome: { status: 'pending' } }
  await deps.db.runTransaction(async (tx: any) => {
    const [paySnap, planSnap, deletionSnap] = await Promise.all([tx.get(ref), tx.get(planRef), tx.get(deletionRef)])
    const fresh = paySnap.data()
    if (fresh?.status === 'paid') { state.outcome = { status: 'already', endsAt: String(fresh.endsAt) }; return }
    const plan = planSnap.exists ? planSnap.data() : {}
    // Nothing is written for an account that is going away, and a permanent Pro plan is never turned into a timed one.
    if (deletionSnap.exists || (plan.plan === 'pro' && !plan.endsAt)) {
      tx.set(ref, { ...fresh, status: 'refund_needed', paidAt: now.toISOString(), channel: verified.channel, reason: deletionSnap.exists ? 'account being deleted' : 'plan has no end date' })
      state.outcome = { status: 'refund_needed' }
      return
    }
    const current = plan.plan === 'pro' && plan.endsAt && new Date(plan.endsAt) > now ? new Date(plan.endsAt) : now
    const endsAt = addMonths(current, Number(payment.months)).toISOString()
    tx.set(ref, { ...fresh, status: 'paid', paidAt: now.toISOString(), channel: verified.channel, endsAt })
    tx.set(planRef, { ...plan, userId: payment.userId, plan: 'pro', endsAt, email: payment.email, reminderFor: null, updatedAt: now.toISOString() })
    state.outcome = { status: 'applied', endsAt }
  })
  const outcome = state.outcome

  if (outcome.status === 'applied') await sendReceipt(deps, ref, { ...payment, reference, endsAt: outcome.endsAt })
  else if (outcome.status === 'refund_needed') console.warn(`[billing] Payment ${reference} was paid but could not be applied. It needs a manual refund.`)
  return outcome
}

async function flagForRefund(deps: BillingDeps, ref: any, payment: any, reason: string): Promise<ApplyResult> {
  await ref.update({ status: 'refund_needed', reason, checkedAt: deps.now().toISOString() }).catch(() => {})
  console.warn(`[billing] Payment ${payment.reference} could not be applied (${reason}). It needs a manual refund.`)
  return { status: 'refund_needed' }
}

/** Sends the receipt and records that it went, so an unsent one can be found and retried. The plan never depends on it. */
async function sendReceipt(deps: BillingDeps, ref: any, payment: any): Promise<boolean> {
  if (!payment.email) return false
  const mail = receiptEmail({ name: payment.name, months: payment.months, amountMinor: payment.amount, currency: payment.currency, reference: payment.reference, endsAt: payment.endsAt, appUrl: deps.env.APP_URL })
  const result = await deps.send({ ...mail, to: payment.email, idempotencyKey: `receipt-${payment.reference}` }).catch(() => ({ sent: false }))
  if (!result.sent) return false
  await ref.update({ receiptSentAt: deps.now().toISOString() }).catch(() => {})
  return true
}

/** Run daily: paid payments whose receipt never went out are sent again (the idempotency key stops duplicates). */
export async function retryUnsentReceipts(deps: BillingDeps, limit = 50): Promise<{ checked: number, sent: number }> {
  const snap = await deps.db.collection(PAYMENTS).where('status', '==', 'paid').get()
  let checked = 0
  let sent = 0
  for (const doc of snap.docs as any[]) {
    const p = doc.data()
    if (p.receiptSentAt || !p.userId || !p.email) continue
    if (checked >= limit) break
    checked++
    if (await sendReceipt(deps, doc.ref, p)) sent++
  }
  return { checked, sent }
}

export interface PaymentSummary { reference: string, amount: number, currency: string, months: number, paidAt: string }

/** The person's own paid payments, newest first. */
export async function listPayments(deps: Pick<BillingDeps, 'db'>, userId: string, limit = 10): Promise<PaymentSummary[]> {
  const snap = await deps.db.collection(PAYMENTS).where('userId', '==', userId).get()
  return (snap.docs as any[])
    .map(d => d.data())
    .filter(p => p.status === 'paid')
    .sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)))
    .slice(0, limit)
    .map(p => ({ reference: p.reference, amount: p.amount, currency: p.currency, months: p.months, paidAt: p.paidAt }))
}
