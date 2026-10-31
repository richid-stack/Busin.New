import { holdStore } from '../browser/holds'
import { browserKey, type BrowserService } from '../browser/service'
import { browserServiceFor } from '../browser/where'

/** A task's own browser session key: one page per task, so a paused task's page is never confused with a chat's. */
export const taskBrowserKey = (userId: string, taskId: string) => browserKey(userId, `task-${taskId}`)

/** The task is over (finished, stopped or cancelled): close its page and forget any wait. Best effort, never throws. */
export async function endTaskBrowser(userId: string, taskId: string, deps: { service?: BrowserService | null, holds?: Pick<ReturnType<typeof holdStore>, 'clear'> } = {}): Promise<void> {
  const key = taskBrowserKey(userId, taskId)
  const service = 'service' in deps ? deps.service : await browserServiceFor(userId).catch(() => null)
  // No browser set up here means no page and no wait to clean up.
  if (!service) return
  await (deps.holds ?? holdStore()).clear(key).catch(() => {})
  await service.close(key).catch(() => {})
}
