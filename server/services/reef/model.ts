/**
 * The shared words of The Reef: what a handle, a project name and a post may look like, the licences a
 * maker may pick, and the one error every Reef store throws (the HTTP layer turns it into a message).
 */

export class ReefError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'limit' | 'blocked' | 'invalid' | 'conflict' | 'forbidden' | 'taken' | 'no_profile' = 'invalid',
    readonly data?: Record<string, unknown>
  ) { super(message) }
}

export const HANDLE_RE = /^[a-z][a-z0-9_]{2,19}$/
/** Handles that would collide with a page address or pretend to be us. `openlobs` is given by hand. */
export const RESERVED_HANDLES = new Set(['openlobs', 'reef', 'the_reef', 'admin', 'administrator', 'support', 'staff', 'moderator', 'mod', 'help', 'security', 'official', 'api', 'u', 'post', 'posts', 'projects', 'questions', 'alerts', 'search', 'new', 'settings', 'null', 'undefined', 'mensahlabs', 'anthropic', 'claude'])

export const PROJECT_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

export const LICENCES = [
  { id: 'cc-by-4.0', short: 'CC BY 4.0', label: 'Open, with credit (CC BY 4.0)', detail: 'Anyone may copy and change it if they credit you.' },
  { id: 'mit', short: 'MIT', label: 'Open (MIT)', detail: 'Anyone may copy and change it, for anything.' },
  { id: 'all-rights-reserved', short: 'All rights reserved', label: 'All rights reserved', detail: 'People may read it and install their own copy to use, but not share a changed version.' }
] as const
export type LicenceId = typeof LICENCES[number]['id']
export const DEFAULT_LICENCE: LicenceId = 'cc-by-4.0'

export const LIMITS = {
  /** Projects one person may keep. */
  projectsPerUser: 30,
  maxTags: 5,
  tagMax: 24,
  readmeMax: 20_000,
  descriptionMax: 240,
  noteMax: 120,
  postMax: 500,
  bioMax: 160,
  placeMax: 40,
  nameMax: 50,
  /** Different people who must report something before it is hidden until looked at. */
  reportsToHide: 3,
  /** Most people whose posts make up the Following tab. */
  followingFeedMax: 50,
  page: 20
}

export const REPORT_REASONS = ['secret', 'harmful', 'spam', 'other'] as const
export type ReportReason = typeof REPORT_REASONS[number]

/** Strips control characters and trims. Line breaks and tabs stay. */
export const cleanText = (value: string) => value.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()

export const tagOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.tagMax)

export const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export const projectIdOf = (owner: string, name: string) => `${owner}__${name}`
