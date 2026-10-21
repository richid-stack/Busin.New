import jexl from 'jexl'
import { fileStore } from '../services/files'
import { InspectError } from '../services/inspect/browser'
import { runInspection } from '../services/inspect/inspect'
import type { InspectDeps } from '../services/inspect/inspect'
import { defaultProvider } from '../services/inspect/screenshot'
import { NodeConfigError } from './workflowNodes'
import { UnsafeUrlError } from './netSafety'
import { interpolateVariables, stripBraces } from './workflowTemplate'

/** The "Visual check" step: screenshot a page, have a vision model judge it, and hand the defects to the steps after it. */
export interface VisualCheckConfig {
  url?: string
  requirements?: string
  /** A list from an earlier look, e.g. `{{first.defects}}`, to check whether those are fixed. */
  previous?: string
  width?: number
  fullPage?: boolean
  colorScheme?: 'light' | 'dark'
}

const clampInt = (v: unknown, lo: number, hi: number) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined
}

export async function runVisualCheckNode(config: VisualCheckConfig, inputs: Record<string, any>, userId: string, signal: AbortSignal | undefined, deps: Partial<InspectDeps> = {}) {
  const url = interpolateVariables(String(config.url || ''), inputs).trim()
  const requirements = interpolateVariables(String(config.requirements || ''), inputs).trim()
  if (!url) throw new NodeConfigError('The Visual check step has no web address.')
  if (/\[[\w.-]+\]/.test(url) && /\{\{/.test(String(config.url))) throw new NodeConfigError('The web address uses a value that is not available yet. Check the {{...}} placeholders.')
  if (requirements.length < 10) throw new NodeConfigError('The Visual check step needs requirements: what the page should look like, so there is something to check it against.')

  let previous: Array<{ id: string, area?: string, problem: string }> | undefined
  const expr = stripBraces(String(config.previous ?? '')).trim()
  if (expr) {
    let value: unknown
    try { value = await jexl.eval(expr, inputs) } catch { throw new NodeConfigError(`The earlier defects "${expr}" could not be worked out.`) }
    if (value !== undefined && value !== null) {
      if (!Array.isArray(value)) throw new NodeConfigError(`"${expr}" is not a list of defects.`)
      previous = value.filter((d: any) => d && typeof d.problem === 'string').slice(0, 15).map((d: any, i) => ({ id: String(d.id ?? `d${i + 1}`).slice(0, 40), area: typeof d.area === 'string' ? d.area.slice(0, 120) : undefined, problem: d.problem.slice(0, 400) }))
    }
  }

  try {
    const result = await runInspection(
      { userId, requirements, url, previous, width: clampInt(config.width, 320, 1920), fullPage: Boolean(config.fullPage), colorScheme: config.colorScheme === 'dark' ? 'dark' : 'light' },
      { provider: defaultProvider(), save: i => fileStore().save(i), signal, ...deps }
    )
    return {
      passed: result.verdict === 'pass',
      verdict: result.verdict,
      score: result.score,
      summary: result.summary,
      defects: result.defects,
      defectCount: result.defects.length,
      counts: result.counts,
      progress: result.progress,
      progressNote: result.progressNote,
      source: result.source,
      screenshotFileId: result.screenshotFileId
    }
  } catch (err: any) {
    if (err instanceof UnsafeUrlError) throw new NodeConfigError(err.message)
    // A bad address or missing setup will not fix itself; a busy or unreachable service may.
    if (err instanceof InspectError && !/could not be reached|too long|busy|try again|unreadable/i.test(err.message)) throw new NodeConfigError(err.message)
    throw err
  }
}
