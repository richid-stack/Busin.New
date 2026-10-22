import { chartTool } from '../../utils/tools/chart'
import { planTool } from '../../utils/tools/plan'
import { weatherTool } from '../../utils/tools/weather'
import { calculatorTool } from '../../utils/tools/calculator'
import { createWebSearchTool } from '../../utils/tools/webSearch'
import { createWebFetchTool } from '../../utils/tools/webFetch'
import { createReadDocumentTool } from '../../utils/tools/readDocument'
import { createInspectDesignTool } from '../../utils/tools/inspectDesign'
import { createDocumentTool, createPresentationTool, createSpreadsheetTool } from '../../utils/tools/createFiles'
import { allowedToolNames } from './registry'

/**
 * The tools a task may use. Every tool is built for the task's owner, then cut down to the groups chosen
 * for the task and to those the registry allows without a person watching.
 */
export function buildTaskTools(userId: string, groups: string[]): Record<string, any> {
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
    calculator: calculatorTool
  }
  const allowed = new Set(allowedToolNames(groups))
  return Object.fromEntries(Object.entries(all).filter(([name]) => allowed.has(name)))
}
