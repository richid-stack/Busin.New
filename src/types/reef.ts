export interface ReefFinding {
  field: string
  kind: string
  severity: 'block' | 'review'
  message: string
  excerpt: string
}
export interface ReefScan { verdict: 'ok' | 'review' | 'blocked', findings: ReefFinding[] }
export interface ReefNeed { id: string, label: string, detail: string, sensitive: boolean }

export interface SharedAgent {
  name: string
  description: string
  instructions: string
  tools: string[]
  skills: string[]
  maxSteps: number
}

export interface SharedItem {
  id: string
  kind: 'agent'
  title: string
  description: string
  payload: SharedAgent
  needs: ReefNeed[]
  scan: ReefScan
  version: number
  authorName: string
  installs: number
  hidden: boolean
  createdAt: string
  updatedAt: string
  /** Only in the list of your own links. */
  agentId?: string
}

export const REPORT_REASONS = [
  { value: 'secret', label: 'It contains a key or password' },
  { value: 'harmful', label: 'It tries to do something harmful or hidden' },
  { value: 'spam', label: 'It is spam or a scam' },
  { value: 'other', label: 'Something else' }
]
