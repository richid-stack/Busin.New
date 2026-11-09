export interface ReefFinding {
  field: string
  kind: string
  severity: 'block' | 'review'
  message: string
  excerpt: string
}
export interface ReefScan { verdict: 'ok' | 'review' | 'blocked', findings: ReefFinding[] }
export interface ReefNeed { id: string, label: string, detail: string, sensitive: boolean }

export interface Author { handle: string, name: string, verified: boolean, official: boolean }

export interface ReefProfile extends Author {
  bio: string
  place: string
  followers: number
  following: number
  starsEarned: number
  projects: number
  createdAt: string
}
export interface PersonPage extends ReefProfile {
  /** Whether the viewer follows them. */
  viewerFollows: boolean
  isMe: boolean
}

export interface ReefMe {
  signedIn: boolean
  name: string
  profile: ReefProfile | null
  unread: number
  admin: boolean
}

export type LicenceId = 'cc-by-4.0' | 'mit' | 'all-rights-reserved'
export const LICENCES: Array<{ id: LicenceId, label: string, detail: string }> = [
  { id: 'cc-by-4.0', label: 'Open, with credit (CC BY 4.0)', detail: 'Anyone may copy and change it if they credit you.' },
  { id: 'mit', label: 'Open (MIT)', detail: 'Anyone may copy and change it, for anything.' },
  { id: 'all-rights-reserved', label: 'All rights reserved', detail: 'People may read it and install their own copy, but not fork it.' }
]

export interface ProjectCard {
  owner: string
  name: string
  kind: 'agent'
  description: string
  tags: string[]
  licence: { id: LicenceId, short: string }
  version: number
  stars: number
  forks: number
  installs: number
  safety: 'passed' | 'review'
  forkedFrom: { owner: string, name: string, version: number } | null
  works: Array<{ id: string, label: string, sensitive: boolean }>
  updatedAt: string
  createdAt: string
}

export interface ProjectDetail extends ProjectCard {
  readme: string
  instructions: string
  skills: string[]
  needs: ReefNeed[]
  scan: ReefScan
  versions: Array<{ version: number, note: string, createdAt: string }>
  files: Array<{ name: string, kind: 'dir' | 'file', note: string, at: string }>
  made: Array<{ label: string, pct: number }>
  isOwner: boolean
  starred: boolean
  author: Author
}

export interface PostView {
  id: string
  type: 'post' | 'question' | 'reply' | 'answer'
  author: Author
  text: string
  title: string
  tags: string[]
  createdAt: string
  likes: number
  replies: number
  liked: boolean
  mine: boolean
  project: ProjectCard | null
  hasProject: boolean
  accepted: string | null
  isAccepted: boolean
}

export interface ReefAlert {
  id: string
  type: 'follow' | 'star' | 'like' | 'reply' | 'answer' | 'fork' | 'accepted'
  actor: Author
  targetType: 'project' | 'post' | 'profile'
  targetId: string
  preview: string
  read: boolean
  createdAt: string
}

export interface ReefSide {
  trending: ProjectCard[]
  people: Array<Author & { followers: number }>
  open: Array<{ id: string, title: string, replies: number, createdAt: string }>
}

export interface QueueItem {
  targetType: 'project' | 'post'
  targetId: string
  reports: number
  reasons: string[]
  notes: string[]
  hidden: boolean
  flagged: boolean
  firstReportedAt: string
}

export const REPORT_REASONS = [
  { value: 'secret', label: 'It contains a key or password' },
  { value: 'harmful', label: 'It tries to do something harmful or hidden' },
  { value: 'spam', label: 'It is spam or a scam' },
  { value: 'other', label: 'Something else' }
]
