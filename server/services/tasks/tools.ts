import { chartTool } from '../../utils/tools/chart'
import { planTool } from '../../utils/tools/plan'
import { weatherTool } from '../../utils/tools/weather'
import { calculatorTool } from '../../utils/tools/calculator'
import { createWebSearchTool } from '../../utils/tools/webSearch'
import { createWebFetchTool } from '../../utils/tools/webFetch'
import { createReadDocumentTool } from '../../utils/tools/readDocument'
import { createInspectDesignTool } from '../../utils/tools/inspectDesign'
import { createDocumentTool, createPresentationTool, createSpreadsheetTool } from '../../utils/tools/createFiles'
import { createBrowserTool } from '../../utils/tools/browser'
import type { TaskBrowser } from '../../utils/tools/browser'
import type { BrowserService } from '../browser/service'
import { holdStore, startWait } from '../browser/holds'
import { browserKey } from '../browser/service'
import { allowedToolNames } from './registry'

/** What a running task hands its tools: how to pause itself, and what the person approved before it paused. */
export interface TaskToolContext { taskId: string, pause: TaskBrowser['pause'], approvedLabel: string | null }

/**
 * The tools a task may use. Every tool is built for the task's owner, then cut down to the groups chosen
 * for the task and to those the registry allows without a person watching.
 */
export function buildTaskTools(userId: string, groups: string[], ctx?: TaskToolContext, browserService: BrowserService | null = null): Record<string, any> {
  const sessionKey = ctx ? browserKey(userId, `task-${ctx.taskId}`) : ''
  const all: Record<string, any> = {
    web_search: createWebSearchTool(userId),
    web_fetch: createWebFetchTool(userId),
    create_document: createDocumentTool(userId),
    create_spreadsheet: createSpreadsheetTool(userId),
    create_presentation: createPresentationTool(userId),
    // A task has no attachments, so these two see only the web.
    inspect_design: createInspectDesignTool(userId, []),
    ...(createReadDocumentTool(userId, []) ? { read_document: createReadDocumentTool(userId, []) } : {}),
    chart: chartTool,
    plan: planTool,
    weather: weatherTool,
    calculator: calculatorTool,
    // Only where a browser is set up, and only inside a running task (which can pause itself).
    ...(browserService && ctx
      ? {
          browser: createBrowserTool(userId, `task-${ctx.taskId}`, browserService, {
            start: w => startWait({ service: browserService, store: holdStore() }, { key: sessionKey, userId, kind: 'task', ref: ctx.taskId, ...w }),
            end: () => holdStore().clear(sessionKey)
          }, { pause: ctx.pause, approvedLabel: ctx.approvedLabel })
        }
      : {})
  }
  const allowed = new Set(allowedToolNames(groups))
  return Object.fromEntries(Object.entries(all).filter(([name]) => allowed.has(name)))
}
