import { holdStore } from '../browser/holds'
import { browserKey, defaultBrowserService } from '../browser/service'

/** A task's own browser session key: one page per task, so a paused task's page is never confused with a chat's. */
export const taskBrowserKey = (userId: string, taskId: string) => browserKey(userId, `task-${taskId}`)

/** The task is over (finished, stopped or cancelled): close its page and forget any wait. Best effort, never throws. */
export async function endTaskBrowser(userId: string, taskId: string, deps: { service?: ReturnType<typeof defaultBrowserService>, holds?: Pick<ReturnType<typeof holdStore>, 'clear'> } = {}): Promise<void> {
  const key = taskBrowserKey(userId, taskId)
  const service = 'service' in deps ? deps.service : defaultBrowserService()
  // No browser set up here means no page and no wait to clean up.
  if (!service) return
  await (deps.holds ?? holdStore()).clear(key).catch(() => {})
  await service.close(key).catch(() => {})
}
