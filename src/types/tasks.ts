export type TaskStatus = 'queued' | 'running' | 'needs_you' | 'verifying' | 'needs_review' | 'done' | 'partial' | 'failed' | 'cancelled'
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
  scheduleId?: string | null
  /** Set while the task is paused for you: what it needs, and when the wait runs out. */
  waiting?: { reason: 'approval' | 'person', label: string, since: string, until: string } | null
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

export const TASK_STATUS: Record<TaskStatus, { label: string, tone: 'quiet' | 'calm' | 'needs' | 'failed', working: boolean }> = {
  queued: { label: 'Waiting', tone: 'quiet', working: true },
  running: { label: 'Working', tone: 'quiet', working: true },
  needs_you: { label: 'Needs you', tone: 'needs', working: false },
  verifying: { label: 'Checking', tone: 'quiet', working: true },
  needs_review: { label: 'Needs your review', tone: 'needs', working: false },
  done: { label: 'Done', tone: 'calm', working: false },
  partial: { label: 'Partly done', tone: 'calm', working: false },
  failed: { label: 'Not done', tone: 'failed', working: false },
  cancelled: { label: 'Cancelled', tone: 'quiet', working: false }
}
