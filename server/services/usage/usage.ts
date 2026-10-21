import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { dayKey, isUnlimited, monthKey, nextDayStart, nextMonthStart, planLimits } from './plans'
import type { PlanId, PlanLimits } from './plans'

export class UsageLimitError extends Error {
  constructor(message: string, readonly reason: 'daily' | 'monthly', readonly resetsAt: string) {
    super(message)
  }
}

const USAGE = 'usage'
const PLANS = 'user_plans'

export interface UsageSnapshot {
  plan: PlanId
  limits: PlanLimits
  usedToday: number
  usedMonth: number
  dayResetsAt: string
  monthResetsAt: string
  unlimited: boolean
  /** When a paid plan ends, if it does. */
  planEndsAt: string | null
}

/** A paid plan that has ended counts as free. */
export async function getPlan(userId: string, now = new Date()): Promise<{ plan: PlanId, endsAt: string | null }> {
  const doc = await getFirebaseDb().collection(PLANS).doc(userId).get()
  if (!doc.exists) return { plan: 'free', endsAt: null }
  const data = doc.data()!
  const endsAt = typeof data.endsAt === 'string' ? data.endsAt : null
  if (data.plan === 'pro' && (!endsAt || new Date(endsAt) > now)) return { plan: 'pro', endsAt }
  return { plan: 'free', endsAt }
}

export async function setPlan(userId: string, plan: PlanId, endsAt: string | null): Promise<void> {
  await getFirebaseDb().collection(PLANS).doc(userId).set({ userId, plan, endsAt, updatedAt: new Date().toISOString() })
}

const usageDoc = (userId: string, now: Date) => getFirebaseDb().collection(USAGE).doc(`${userId}__${monthKey(now)}`)

const friendly = (reason: 'daily' | 'monthly', limits: PlanLimits, resetsAt: Date) => {
  const when = reason === 'daily'
    ? 'It resets at midnight (Ghana time).'
    : `It resets on ${resetsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}.`
  const limit = reason === 'daily' ? limits.daily : limits.monthly
  const upgrade = limits.id === 'pro' ? '' : ' You can upgrade in Settings for more.'
  return `You have used your ${reason} limit of ${limit} credits on the ${limits.label} plan. ${when}${upgrade}`
}

/**
 * Takes `cost` credits, or throws UsageLimitError without taking any. Checked and written in one
 * transaction so two requests at once cannot both slip under the limit.
 */
export async function consumeCredits(userId: string, plan: PlanId, cost: number, now = new Date()): Promise<void> {
  if (isUnlimited(userId) || cost <= 0) return
  const limits = planLimits(plan)
  const today = dayKey(now)
  const ref = usageDoc(userId, now)

  await getFirebaseDb().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? snap.data() : { userId, month: monthKey(now), total: 0, days: {}, tokens: { input: 0, output: 0 } }
    const usedToday = Number(data.days?.[today] ?? 0)
    const usedMonth = Number(data.total ?? 0)

    if (usedToday + cost > limits.daily) {
      const resets = nextDayStart(now)
      throw new UsageLimitError(friendly('daily', limits, resets), 'daily', resets.toISOString())
    }
    if (usedMonth + cost > limits.monthly) {
      const resets = nextMonthStart(now)
      throw new UsageLimitError(friendly('monthly', limits, resets), 'monthly', resets.toISOString())
    }
    tx.set(ref, { ...data, days: { ...(data.days ?? {}), [today]: usedToday + cost }, total: usedMonth + cost, updatedAt: now.toISOString() })
  })
}

/** Gives credits back when a call failed before it did any work. Never goes below zero. */
export async function refundCredits(userId: string, cost: number, now = new Date()): Promise<void> {
  if (isUnlimited(userId) || cost <= 0) return
  const today = dayKey(now)
  const ref = usageDoc(userId, now)
  await getFirebaseDb().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return
    const data = snap.data()
    tx.set(ref, {
      ...data,
      days: { ...(data.days ?? {}), [today]: Math.max(0, Number(data.days?.[today] ?? 0) - cost) },
      total: Math.max(0, Number(data.total ?? 0) - cost)
    })
  })
}

/** Adds to the month's token totals, for the person's own usage page. Best effort. */
export async function recordTokens(userId: string, input: number, output: number, now = new Date()): Promise<void> {
  if (!input && !output) return
  const ref = usageDoc(userId, now)
  await getFirebaseDb().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return
    const data = snap.data()
    tx.set(ref, { ...data, tokens: { input: Number(data.tokens?.input ?? 0) + input, output: Number(data.tokens?.output ?? 0) + output } })
  })
}

export async function getUsage(userId: string, now = new Date()): Promise<UsageSnapshot & { tokens: { input: number, output: number } }> {
  const [{ plan, endsAt }, snap] = await Promise.all([getPlan(userId, now), usageDoc(userId, now).get()])
  const data = snap.exists ? snap.data()! : {}
  return {
    plan,
    limits: planLimits(plan),
    usedToday: Number(data.days?.[dayKey(now)] ?? 0),
    usedMonth: Number(data.total ?? 0),
    dayResetsAt: nextDayStart(now).toISOString(),
    monthResetsAt: nextMonthStart(now).toISOString(),
    unlimited: isUnlimited(userId),
    planEndsAt: endsAt,
    tokens: { input: Number(data.tokens?.input ?? 0), output: Number(data.tokens?.output ?? 0) }
  }
}

/**
 * The one call the rest of the app makes. Takes the plan into account and fails open on storage
 * trouble: an outage in usage counting must not stop people working, but a real limit always does.
 */
export async function chargeUsage(userId: string, cost: number, opts: { guest?: boolean } = {}): Promise<{ refund: () => Promise<void> }> {
  const noop = { refund: async () => {} }
  if (cost <= 0 || isUnlimited(userId)) return noop
  try {
    const plan: PlanId = opts.guest ? 'guest' : (await getPlan(userId)).plan
    // The refund goes back to the day and month it was taken from, even if midnight passes while the reply runs.
    const chargedAt = new Date()
    await consumeCredits(userId, plan, cost, chargedAt)
    return { refund: () => refundCredits(userId, cost, chargedAt).catch(err => console.warn('Usage refund failed:', err?.message)) }
  } catch (err) {
    if (err instanceof UsageLimitError) throw err
    console.warn('Usage counting unavailable, allowing the request:', (err as Error)?.message)
    return noop
  }
}
