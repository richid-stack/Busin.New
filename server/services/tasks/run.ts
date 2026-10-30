import { generateObject } from 'ai'
import { fileStore } from '../files'
import { runInspection } from '../inspect/inspect'
import { defaultProvider } from '../inspect/screenshot'
import { chargeUsage } from '../usage/usage'
import { modelCost } from '../usage/plans'
import { getLanguageModel, pickAvailableModel } from '../../utils/models'
import { parseMyModelId } from '../../../shared/modelProviders'
import { resolveModel } from '../models/resolve'
import { runTask } from './orchestrator'
import type { RunDeps } from './orchestrator'
import { notifyTaskFinished, defaultNotifyDeps } from '../notifications/notify'
import type { Task } from './model'
import { taskStore } from './store'
import type { TaskStore } from './store'
import { buildTaskTools } from './tools'
import { endTaskBrowser } from './taskBrowser'
import { modelJudge, verifyCriteria } from './verify'

/** The real parts a task runs with. Tests swap them for fakes through `runTask` directly. */
export function liveDeps(store: TaskStore = taskStore()): RunDeps {
  const pick = async (modelId: string | null, userId: string) => {
    // The person's own model runs on their own key: never swapped for another, and it costs no credits.
    if (modelId && parseMyModelId(modelId)) return { id: modelId, model: (await resolveModel(userId, modelId)).model }
    const id = pickAvailableModel(modelId)
    return id ? { id, model: getLanguageModel(id) } : null
  }
  return {
    store,
    tools: (task, ctx) => buildTaskTools(task.userId, task.tools, ctx),
    model: task => pick(task.model, task.userId),
    costOf: id => (parseMyModelId(id) ? 0 : modelCost(id)),
    charge: chargeUsage,
    verify: async (criteria, ctx, task) => {
      const chosen = await pick(task.model, task.userId).catch(() => null)
      return await verifyCriteria(criteria, ctx, {
        inspect: input => runInspection(input, { provider: defaultProvider(), save: i => fileStore().save(i) }),
        judgeCheck: async (input) => {
          if (!chosen) return { status: 'unsure', reason: 'No AI model is available to judge this.', fix: '' }
          const charge = await chargeUsage(task.userId, parseMyModelId(chosen.id) ? 0 : modelCost(chosen.id))
          try { return await modelJudge(chosen.model, { generate: generateObject })(input) } catch (err) { await charge.refund(); throw err }
        }
      })
    }
  }
}

const emailWhenFinished = (task: Task) => notifyTaskFinished(defaultNotifyDeps(), task)

export interface QueueSummary { started: number, finished: number }

/**
 * Works through waiting tasks (and ones whose worker disappeared) until the time budget is used.
 * Called by the timer endpoint and, as a nudge, right after a task is created. Safe to call from
 * several places at once: each task is claimed by exactly one worker.
 */
export async function processQueue(opts: { budgetMs?: number, maxTasks?: number, deps?: RunDeps, onFinished?: (task: Task) => Promise<unknown> } = {}): Promise<QueueSummary> {
  const deps = opts.deps ?? liveDeps()
  const startedAt = Date.now()
  const summary: QueueSummary = { started: 0, finished: 0 }
  while (summary.started < (opts.maxTasks ?? 3) && Date.now() - startedAt < (opts.budgetMs ?? 60_000)) {
    const claimed = await deps.store.claimNext()
    if (!claimed) break
    summary.started++
    await runTask(claimed.task, claimed.lease, deps)
      .then(async (task) => {
        summary.finished++
        // Paused for the person: the page stays open and the "needs you" email goes out from the timer. Nothing has finished.
        if (task.status === 'needs_you') return
        await endTaskBrowser(task.userId, task.id).catch(() => {})
        // An email is a courtesy: it never changes how the task ended.
        await (opts.onFinished ?? emailWhenFinished)(task).catch(err => console.warn('[task] result email not sent:', err?.message))
      }).catch(err => console.error('[task] worker error:', err?.message))
  }
  return summary
}
