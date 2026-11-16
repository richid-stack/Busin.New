import { z } from 'zod'
import { RUN_LIMITS, checkStep, isSecretFile, relPath, runStepSchema } from './runPlan'

/**
 * A plan for the cloud box: the same steps and the same rulebook as on the person's own computer (shared/runPlan.ts),
 * plus a few small text files written into the empty box first, so a script the assistant wrote can be run.
 * The box starts empty, runs the plan, and is thrown away. Nothing from it is kept.
 */
export const CLOUD_LIMITS = {
  maxFiles: 8,
  maxFileChars: 30_000,
  maxTotalChars: 80_000,
  /** The whole plan has to finish inside one chat request, the same as on a computer. */
  planMs: RUN_LIMITS.planMs
}

export const boxFileSchema = z.object({
  path: z.string().min(1).max(120),
  content: z.string().max(CLOUD_LIMITS.maxFileChars)
}).strict().superRefine((f, ctx) => {
  try { relPath(f.path, 'file name') } catch (err) { ctx.addIssue({ code: 'custom', path: ['path'], message: (err as Error).message }); return }
  if (f.path.trim().endsWith('/') || f.path.trim() === '.') ctx.addIssue({ code: 'custom', path: ['path'], message: `"${f.path}" is a folder, not a file.` })
  if (isSecretFile(f.path)) ctx.addIssue({ code: 'custom', path: ['path'], message: `"${f.path}" looks like a file that holds passwords or keys, so it is never written.` })
  if (f.path.split('/').some(p => p.toLowerCase() === '.git')) ctx.addIssue({ code: 'custom', path: ['path'], message: 'Files inside .git are not allowed.' })
  if (f.content.includes('\0')) ctx.addIssue({ code: 'custom', path: ['content'], message: 'Only plain text files can be written.' })
})
export type BoxFile = z.infer<typeof boxFileSchema>

const filesProblem = (files: BoxFile[]): string | null => {
  const seen = new Set<string>()
  let total = 0
  for (const f of files) {
    // A bad name is reported by the file's own check; here it only has to not crash the comparison.
    let key = f.path.trim().toLowerCase()
    try { key = relPath(f.path).toLowerCase() } catch { /* reported on the file itself */ }
    if (seen.has(key)) return `The file "${f.path}" is listed twice.`
    seen.add(key)
    total += f.content.length
  }
  return total > CLOUD_LIMITS.maxTotalChars ? `The files are too large together (more than ${Math.round(CLOUD_LIMITS.maxTotalChars / 1000)} thousand characters).` : null
}

/** What the assistant proposes. Refused here (before any card) if a step or a file is not allowed. */
export const cloudPlanSchema = z.object({
  why: z.string().trim().min(3).max(300),
  steps: z.array(runStepSchema).min(1).max(RUN_LIMITS.maxSteps),
  files: z.array(boxFileSchema).max(CLOUD_LIMITS.maxFiles).default([])
}).superRefine((plan, ctx) => {
  plan.steps.forEach((s, i) => {
    const c = checkStep(s)
    if (!c.ok) ctx.addIssue({ code: 'custom', path: ['steps', i], message: `Step ${i + 1}: ${c.error}` })
  })
  const bad = filesProblem(plan.files)
  if (bad) ctx.addIssue({ code: 'custom', path: ['files'], message: bad })
})
export type CloudPlanInput = z.input<typeof cloudPlanSchema>

/** What the app sends the box worker. The worker checks all of it again. */
export const boxRequestSchema = z.object({
  steps: z.array(runStepSchema).min(1).max(RUN_LIMITS.maxSteps),
  files: z.array(boxFileSchema).max(CLOUD_LIMITS.maxFiles).default([]),
  limitMs: z.number().int().min(10_000).max(CLOUD_LIMITS.planMs).default(CLOUD_LIMITS.planMs)
}).strict().superRefine((req, ctx) => {
  req.steps.forEach((s, i) => {
    const c = checkStep(s)
    if (!c.ok) ctx.addIssue({ code: 'custom', path: ['steps', i], message: `Step ${i + 1}: ${c.error}` })
  })
  const bad = filesProblem(req.files)
  if (bad) ctx.addIssue({ code: 'custom', path: ['files'], message: bad })
})

export const boxStepResultSchema = z.object({
  n: z.number().int(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  ms: z.number().nonnegative(),
  output: z.string().max(RUN_LIMITS.maxOutputChars + 200),
  outputTruncated: z.boolean(),
  /** Set when the step could not be started at all (the reason, in plain words). */
  error: z.string().max(400).optional()
})
export const boxResponseSchema = z.object({
  steps: z.array(boxStepResultSchema).max(RUN_LIMITS.maxSteps),
  /** Set when the whole plan was refused or ran out of time before it started. */
  error: z.string().max(400).optional()
})
export type BoxResponse = z.infer<typeof boxResponseSchema>
