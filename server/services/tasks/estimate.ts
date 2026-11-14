import { pickAvailableModel } from '../../utils/models'
import { parseMyModelId } from '../../../shared/modelProviders'
import { modelCost } from '../usage/plans'
import { LIMITS } from './model'

export interface CreditEstimate {
  /** Credits if the first attempt is accepted. */
  min: number
  /** Credits if every attempt is used. */
  max: number
}

/**
 * What a task will draw from the person's credits. Each attempt is one model call for the work, and every check judged by AI
 * is one more call on the same model. A page that must look right is judged by AI too. A model the person connected with their
 * own key costs nothing here. This is an estimate before the run; the real count is taken as the task goes.
 */
export function estimateTaskCredits(input: { criteria: { kind: string }[], model?: string | null, maxAttempts?: number }): CreditEstimate {
  const modelId = input.model ?? pickAvailableModel(null)
  if (modelId && parseMyModelId(modelId)) return { min: 0, max: 0 }
  const each = modelCost(modelId)
  const judged = input.criteria.filter(c => c.kind === 'check' || c.kind === 'visual').length
  const attempt = each * (1 + judged)
  return { min: attempt, max: attempt * (input.maxAttempts ?? LIMITS.attempts.default) }
}

/** The line the card shows, in plain words. */
export function describeEstimate(e: CreditEstimate): string {
  if (e.max === 0) return 'Free: it runs on your own model key.'
  const credits = (n: number) => `${n} credit${n === 1 ? '' : 's'}`
  return e.min === e.max ? `About ${credits(e.min)}.` : `About ${e.min} to ${credits(e.max)}, depending on how many attempts it needs.`
}
