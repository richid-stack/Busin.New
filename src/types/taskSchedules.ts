import type { NewTask } from './tasks'

export type ScheduleResult = '' | 'started' | 'done' | 'partial' | 'needs_review' | 'failed' | 'cancelled' | 'skipped' | 'missed'

export interface TaskScheduleItem {
  id: string
  title: string
  task: NewTask & { tools?: string[] }
  cron: string | null
  timezone: string
  runAt: string | null
  enabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastTaskId: string | null
  lastResult: ScheduleResult
  note: string
  awaiting: boolean
  failures: number
  runs: number
  error: string
  createdAt: string
  updatedAt: string
}

export interface NewTaskSchedule {
  title?: string
  task: NewTask
  cron?: string
  timezone?: string
  runAt?: string
}

export const RESULT_DOT: Record<ScheduleResult, string> = {
  '': 'bg-neutral-400',
  started: 'bg-primary animate-pulse',
  done: 'bg-success',
  partial: 'bg-warning',
  needs_review: 'bg-warning',
  failed: 'bg-error',
  cancelled: 'bg-neutral-400',
  skipped: 'bg-neutral-400',
  missed: 'bg-warning'
}
