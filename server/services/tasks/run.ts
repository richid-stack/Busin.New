import { generateObject } from 'ai'
import { fileStore } from '../files'
import { runInspection } from '../inspect/inspect'
import { defaultProvider } from '../inspect/screenshot'
import { chargeUsage } from '../usage/usage'
import { modelCost } from '../usage/plans'
import { getLanguageModel, pickAvailableModel } from '../../utils/models'
import { runTask } from './orchestrator'
import type { RunDeps } from './orchestrator'
import { taskStore } from './store'
import type { TaskStore } from './store'
import { buildTaskTools } from './tools'
import { modelJudge, verifyCriteria } from './verify'

/** The real parts a task runs with. Tests swap them for fakes through `runTask` directly. */
export function liveDeps(store: TaskStore = taskStore()): RunDeps {
  const pick = (modelId: string | null) => {
    const id = pickAvailableModel(modelId)
    return id ? { id, model: getLanguageModel(id) } : null
  }
  return {
    store,
    tools: task => buildTaskTools(task.userId, task.tools),
    model: task => pick(task.model),
    costOf: modelCost,
    charge: chargeUsage,
    verify: async (criteria, ctx, task) => {
      const chosen = pick(task.model)
      return await verifyCriteria(criteria, ctx, {
        inspect: input => runInspection(input, { provider: defaultProvider(), save: i => fileStore().save(i) }),
        judgeCheck: async (input) => {
          if (!chosen) return { status: 'unsure', reason: 'No AI model is available to judge this.', fix: '' }
          const charge = await chargeUsage(task.userId, modelCost(chosen.id))
          try { return await modelJudge(chosen.model, { generate: generateObject })(input) } catch (err) { await charge.refund(); throw err }
        }
      })
    }
  }
}

export interface QueueSummary { started: number, finished: number }

/**
 * Works through waiting tasks (and ones whose worker disappeared) until the time budget is used.
 * Called by the timer endpoint and, as a nudge, right after a task is created. Safe to call from
 * several places at once: each task is claimed by exactly one worker.
 */
export async function processQueue(opts: { budgetMs?: number, maxTasks?: number, deps?: RunDeps } = {}): Promise<QueueSummary> {
  const deps = opts.deps ?? liveDeps()
  const startedAt = Date.now()
  const summary: QueueSummary = { started: 0, finished: 0 }
  while (summary.started < (opts.maxTasks ?? 3) && Date.now() - startedAt < (opts.budgetMs ?? 60_000)) {
    const claimed = await deps.store.claimNext()
    if (!claimed) break
    summary.started++
    await runTask(claimed.task, claimed.lease, deps).then(() => { summary.finished++ }).catch(err => console.error('[task] worker error:', err?.message))
  }
  return summary
}
