/**
 * What each plan may use. Usage is counted in credits: a normal message costs 1, a more expensive
 * model costs more. Days and months are UTC, which is Ghana time.
 */
export type PlanId = 'guest' | 'free' | 'pro'

export interface PlanLimits {
  id: PlanId
  label: string
  daily: number
  monthly: number
}

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

/** Limits are read each time so they can be tuned from the environment without a code change. */
export function planLimits(plan: PlanId): PlanLimits {
  switch (plan) {
    case 'guest': return { id: 'guest', label: 'Guest', daily: num(process.env.USAGE_GUEST_DAILY, 5), monthly: num(process.env.USAGE_GUEST_MONTHLY, 5) }
    case 'pro': return { id: 'pro', label: 'Pro', daily: num(process.env.USAGE_PRO_DAILY, 300), monthly: num(process.env.USAGE_PRO_MONTHLY, 5000) }
    default: return { id: 'free', label: 'Free', daily: num(process.env.USAGE_FREE_DAILY, 30), monthly: num(process.env.USAGE_FREE_MONTHLY, 400) }
  }
}

/** Credits one model call costs. Anything not listed costs 1. */
const MODEL_COST: Record<string, number> = {
  'anthropic/claude-haiku-4.5': 3,
  'google/gemini-3.8-flash': 2,
  'groq/gpt-oss-120b': 2
}

export const modelCost = (modelId: string | null | undefined) => (modelId && MODEL_COST[modelId]) || 1

export const dayKey = (now: Date) => now.toISOString().slice(0, 10)
export const monthKey = (now: Date) => now.toISOString().slice(0, 7)

/** Midnight UTC at the end of this day. */
export const nextDayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
/** Midnight UTC on the first of next month. */
export const nextMonthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

/** Owners and testers listed in USAGE_UNLIMITED_USER_IDS are never limited. */
export const isUnlimited = (userId: string) =>
  (process.env.USAGE_UNLIMITED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(userId)
