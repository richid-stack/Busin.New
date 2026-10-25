import { z } from 'zod'
import { MODELS } from '../../../shared/utils/models'
import { parseMyModelId } from '../../../shared/modelProviders'

/**
 * A task is a goal, the ways we will know it was met, and a record of what happened. It is not a chat:
 * it runs on its own, may take minutes, and ends with an honest verdict for every criterion.
 */

export const TASK_STATUSES = ['queued', 'running', 'verifying', 'needs_review', 'done', 'partial', 'failed', 'cancelled'] as const
export type TaskStatus = typeof TASK_STATUSES[number]

export const FINAL_STATUSES: TaskStatus[] = ['done', 'partial', 'failed', 'cancelled']

/** Who may move a task from one status to the next. Anything else is a bug or a stale writer and is refused. */
const NEXT: Record<TaskStatus, TaskStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['verifying', 'failed', 'cancelled', 'queued'],
  verifying: ['running', 'done', 'partial', 'needs_review', 'failed', 'cancelled'],
  needs_review: ['done', 'cancelled'],
  done: [],
  partial: [],
  failed: [],
  cancelled: []
}
export const canTransition = (from: TaskStatus, to: TaskStatus) => from === to || NEXT[from].includes(to)
export const isFinal = (s: TaskStatus) => FINAL_STATUSES.includes(s)

export const CRITERION_KINDS = ['file', 'visual', 'check', 'manual'] as const
export type CriterionKind = typeof CRITERION_KINDS[number]
export const FILE_FORMATS = ['docx', 'pdf', 'xlsx', 'pptx'] as const

export const LIMITS = {
  goalMin: 10,
  goalMax: 2000,
  maxCriteria: 8,
  attempts: { min: 1, max: 3, default: 2 },
  steps: { min: 3, max: 15, default: 10 },
  minutes: { min: 1, max: 10, default: 6 },
  /** Tasks one person may have running or waiting at once. */
  maxActive: 3,
  /** Tasks kept per person; the oldest finished ones go first. */
  maxKept: 100,
  maxEvents: 300
}

/** Tool groups a task may use. Groups that act in a person's accounts or reach outside servers are not offered yet. */
export const TASK_TOOL_GROUPS = ['web', 'read_files', 'create_files', 'inspect', 'utilities'] as const
export const DEFAULT_TASK_GROUPS: string[] = ['web', 'create_files', 'inspect', 'utilities']

const text = (min: number, max: number, what: string) => z.string().transform(s => s.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
  .pipe(z.string().min(min, `${what} is too short.`).max(max, `${what} can be at most ${max} characters.`))

export const criterionInputSchema = z.object({
  text: text(3, 300, 'A criterion'),
  kind: z.enum(CRITERION_KINDS).default('check'),
  format: z.enum(FILE_FORMATS).optional(),
  url: z.string().max(2000).optional()
}).superRefine((c, ctx) => {
  if (c.kind === 'visual' && !c.url) ctx.addIssue({ code: 'custom', message: 'A visual criterion needs the web address to look at.', path: ['url'] })
})

export const taskInputSchema = z.object({
  goal: text(LIMITS.goalMin, LIMITS.goalMax, 'The goal'),
  criteria: z.array(criterionInputSchema).max(LIMITS.maxCriteria).default([]),
  tools: z.array(z.string()).max(TASK_TOOL_GROUPS.length).default(DEFAULT_TASK_GROUPS)
    .refine(list => list.every(id => (TASK_TOOL_GROUPS as readonly string[]).includes(id)), 'That tool group is not available to tasks yet.')
    .transform(list => TASK_TOOL_GROUPS.filter(id => list.includes(id))),
  model: z.string().nullable().optional().default(null).refine(m => m === null || MODELS.some(x => x.value === m) || parseMyModelId(m) !== null, 'Unknown model'),
  maxAttempts: z.coerce.number().int().min(LIMITS.attempts.min).max(LIMITS.attempts.max).default(LIMITS.attempts.default),
  maxSteps: z.coerce.number().int().min(LIMITS.steps.min).max(LIMITS.steps.max).default(LIMITS.steps.default),
  maxMinutes: z.coerce.number().int().min(LIMITS.minutes.min).max(LIMITS.minutes.max).default(LIMITS.minutes.default)
})
export type TaskInput = z.infer<typeof taskInputSchema>

export type CriterionStatus = 'unchecked' | 'met' | 'unmet' | 'unsure' | 'pending'

export interface Criterion {
  id: string
  text: string
  kind: CriterionKind
  format?: typeof FILE_FORMATS[number]
  url?: string
  status: CriterionStatus
  /** What the verdict rests on, in plain words. */
  evidence: string
  /** What to change, when it was not met. Fed to the next attempt. */
  fix?: string
}

export interface Artifact { fileId: string, name: string, format?: string, sizeKb?: number }

export interface Task {
  id: string
  userId: string
  goal: string
  status: TaskStatus
  criteria: Criterion[]
  tools: string[]
  model: string | null
  maxAttempts: number
  maxSteps: number
  maxMinutes: number
  attempts: number
  artifacts: Artifact[]
  /** The agent's own account of what it did. Shown to the person, never trusted as proof. */
  result: string
  /** One honest sentence on how it ended. */
  outcome: string
  error: string
  eventCount: number
  leaseUntil: string | null
  leaseToken: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type EventKind = 'created' | 'attempt' | 'tool' | 'note' | 'verify' | 'status' | 'error'
export interface TaskEvent { id: string, at: string, kind: EventKind, text: string, data?: Record<string, unknown> }

/** The default when no criteria were given: one that a model can judge, so every task ends with a verdict. */
export const DEFAULT_CRITERION = 'The result does what the goal asks, completely and without errors.'
