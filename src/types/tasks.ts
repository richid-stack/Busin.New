export type TaskStatus = 'queued' | 'running' | 'verifying' | 'needs_review' | 'done' | 'partial' | 'failed' | 'cancelled'
export type CriterionKind = 'file' | 'visual' | 'check' | 'manual'
export type CriterionStatus = 'unchecked' | 'met' | 'unmet' | 'unsure' | 'pending'

export interface TaskCriterion {
  id: string
  text: string
  kind: CriterionKind
  format?: string
  url?: string
  status: CriterionStatus
  evidence: string
  fix?: string
}

export interface TaskArtifact { fileId: string, name: string, format?: string, sizeKb?: number }

export interface TaskItem {
  id: string
  goal: string
  status: TaskStatus
  criteria: TaskCriterion[]
  tools: string[]
  attempts: number
  maxAttempts: number
  maxSteps: number
  maxMinutes: number
  artifacts: TaskArtifact[]
  result: string
  outcome: string
  error: string
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface TaskEventItem { id: string, at: string, kind: string, text: string }

export interface NewTask {
  goal: string
  criteria: Array<{ text: string, kind: CriterionKind, format?: string, url?: string }>
  tools?: string[]
  maxAttempts?: number
  maxMinutes?: number
}

export const TASK_STATUS: Record<TaskStatus, { label: string, dot: string, working: boolean }> = {
  queued: { label: 'Waiting', dot: 'bg-neutral-400', working: true },
  running: { label: 'Working', dot: 'bg-primary animate-pulse', working: true },
  verifying: { label: 'Checking', dot: 'bg-primary animate-pulse', working: true },
  needs_review: { label: 'Needs your review', dot: 'bg-warning', working: false },
  done: { label: 'Done', dot: 'bg-success', working: false },
  partial: { label: 'Partly done', dot: 'bg-warning', working: false },
  failed: { label: 'Not done', dot: 'bg-error', working: false },
  cancelled: { label: 'Cancelled', dot: 'bg-neutral-400', working: false }
}
