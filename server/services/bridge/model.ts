import { z } from 'zod'
import { RUN_LIMITS, runJobInputSchema, checkStep } from '../../../shared/runPlan'
import { SHEET_LIMITS, workbookApplyInput, workbookApplyResult, workbookInspectInput, workbookInspectResult, workbookListInput, workbookListResult } from '../../../shared/sheetOps'

/**
 * OpenLobs Bridge: a small program on a person's own computer that OpenLobs can ask to do approved things.
 * The server never sends a command to run. It sends a named job from a short, fixed list; the Bridge checks
 * that list itself and refuses anything else. Today the list has a harmless ping, a read-only browser look, and three spreadsheet jobs that work only inside a folder the person chose.
 */

export const LIMITS = {
  maxDevices: 3,
  pairingTtlMs: 10 * 60_000,
  /** A device that has not called in for this long shows as offline. */
  onlineWindowMs: 60_000,
  pollWaitMs: 25_000,
  /** How often a waiting poll looks at the database. Jobs made on the same server wake it at once. */
  pollCheckMs: 12_000,
  jobTtlMs: 2 * 60_000,
  maxOpenJobs: 5,
  maxEvents: 100,
  maxResultChars: 8000,
  lastSeenWriteMs: 30_000,
  keptJobs: 30
}

export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const TOKEN_PREFIX = 'olb_'

export type Platform = 'windows' | 'mac' | 'linux' | 'other'

export interface Device {
  id: string
  userId: string
  name: string
  platform: Platform
  bridgeVersion: string
  capabilities: string[]
  pairedAt: string
  lastSeenAt: string | null
  revokedAt: string | null
}

export type JobStatus = 'queued' | 'sent' | 'done' | 'failed' | 'cancelled' | 'expired'
export const OPEN_JOB: JobStatus[] = ['queued', 'sent']

export interface Job {
  id: string
  userId: string
  deviceId: string
  kind: JobKind
  status: JobStatus
  input: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string
  /** A picture the computer sent for this job, kept in the file store. Set by the server, never by the computer's report. */
  fileId: string | null
  /** Set once the device has seen that the job was cancelled. */
  cancelAcked: boolean
  createdAt: string
  sentAt: string | null
  finishedAt: string | null
  expiresAt: string
}

export type EventKind = 'paired' | 'job' | 'revoked' | 'note'
export interface DeviceEvent { id: string, at: string, kind: EventKind, text: string }

/** The jobs a Bridge may be asked for. Adding one means adding it here and in the Bridge, on purpose. */
export const JOB_KINDS = ['ping', 'browser_look', 'workbook_list', 'workbook_inspect', 'workbook_apply', 'run_command', 'folder_look', 'folder_read'] as const
export type JobKind = typeof JOB_KINDS[number]

export const isJobKind = (k: unknown): k is JobKind => (JOB_KINDS as readonly string[]).includes(String(k))

/** What a person can allow on a computer. A ping is always allowed: it reveals nothing and changes nothing. */
export const PERMISSIONS = ['browser', 'excel', 'run'] as const
export type Permission = typeof PERMISSIONS[number]
/** Which permission a job needs, if any. */
export const JOB_PERMISSION: Partial<Record<JobKind, Permission>> = { browser_look: 'browser', workbook_list: 'excel', workbook_inspect: 'excel', workbook_apply: 'excel', run_command: 'run', folder_look: 'run', folder_read: 'run' }
export const PERMISSION_LABEL: Record<Permission, string> = { browser: 'Look at web pages', excel: 'Work on spreadsheets in one folder', run: 'Run approved commands in one folder' }
/** Permissions that need the person to choose a folder on the computer. */
export const NEEDS_FOLDER: Permission[] = ['excel', 'run']

const short = (n: number) => z.string().trim().min(1).max(n)

/** What a Bridge says about itself when it pairs. */
export const pairInputSchema = z.object({
  code: z.string().transform(s => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).pipe(z.string().length(8)),
  name: short(60),
  platform: z.enum(['windows', 'mac', 'linux', 'other']).default('other'),
  version: short(30)
})

/** What the server accepts back from a ping. It came from another computer, so it is checked like any outside input. */
export const pingResultSchema = z.object({
  bridgeVersion: short(30),
  platform: short(30),
  osVersion: z.string().max(120).default(''),
  time: z.string().max(40),
  capabilities: z.array(short(40)).max(20).default([])
}).strict()

/** Where a browser look may go. Private-network addresses are refused on the computer itself, which can see its own network. */
const webAddress = z.string().trim().min(1).max(2000).refine((raw) => {
  try {
    const u = new URL(raw)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password
  } catch { return false }
}, 'Use a web address that starts with http:// or https:// and has no user name or password.')

export const browserLookInputSchema = z.object({
  url: webAddress,
  width: z.number().int().min(320).max(1920).default(1280),
  height: z.number().int().min(320).max(1600).default(800),
  fullPage: z.boolean().default(false),
  colorScheme: z.enum(['light', 'dark']).default('light')
}).strict()
export type BrowserLookInput = z.infer<typeof browserLookInputSchema>

/** What the server accepts back from a browser look. The picture travels separately, as a file. */
export const browserLookResultSchema = z.object({
  title: z.string().max(200).default(''),
  finalUrl: z.string().max(2000),
  status: z.number().int().min(0).max(999).nullable().default(null),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(6000),
  consoleErrors: z.array(z.string().max(200)).max(10).default([]),
  failedRequests: z.array(z.string().max(300)).max(10).default([])
}).strict()
export type BrowserLookResult = z.infer<typeof browserLookResultSchema>

export const folderLookInput = z.object({ path: z.string().trim().max(120).optional(), depth: z.union([z.literal(1), z.literal(2)]).optional() }).strict()
export const folderReadInput = z.object({ file: z.string().trim().min(1).max(120) }).strict()

/** What the server accepts back from a command. The output is only ever shown as text. */
export const runCommandResult = z.object({
  exitCode: z.number().int().min(-1).max(255),
  timedOut: z.boolean(),
  ms: z.number().int().min(0),
  output: z.string().max(RUN_LIMITS.maxOutputChars + 500),
  outputTruncated: z.boolean()
}).strict()
export const folderLookResult = z.object({
  path: z.string().max(200),
  entries: z.array(z.object({ name: z.string().max(200), type: z.enum(['file', 'folder']), sizeKb: z.number().int().min(0).optional() }).strict()).max(RUN_LIMITS.maxListed),
  truncated: z.boolean(),
  hidden: z.number().int().min(0)
}).strict()
export const folderReadResult = z.object({ name: z.string().max(200), text: z.string().max(RUN_LIMITS.maxReadChars + 50), truncated: z.boolean(), sizeKb: z.number().int().min(0) }).strict()

/** A job's input, checked and filled in. Throws a message fit to show a person. */
export function parseJobInput(kind: JobKind, raw: unknown): Record<string, unknown> {
  if (kind === 'ping') return {}
  if (kind === 'run_command') {
    // The same rulebook the computer applies. A step that breaks it never leaves the server.
    const parsed = runJobInputSchema.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'That is not a valid step.')
    const step: Record<string, unknown> = { ...parsed.data }
    delete step.limitMs
    const checked = checkStep(step)
    if (!checked.ok) throw new Error(checked.error)
    return parsed.data as Record<string, unknown>
  }
  if (kind === 'folder_look') {
    const parsed = folderLookInput.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'That is not a valid request.')
    return parsed.data
  }
  if (kind === 'folder_read') {
    const parsed = folderReadInput.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'That is not a valid request.')
    return parsed.data
  }
  const schema = kind === 'browser_look' ? browserLookInputSchema : kind === 'workbook_list' ? workbookListInput : kind === 'workbook_inspect' ? workbookInspectInput : workbookApplyInput
  const parsed = schema.safeParse(raw ?? {})
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'That is not a valid request.')
  return parsed.data as Record<string, unknown>
}

/** What each kind of job may send back, and how much of it. */
export const RESULT_SCHEMA: Record<JobKind, z.ZodType> = {
  ping: pingResultSchema,
  browser_look: browserLookResultSchema,
  workbook_list: workbookListResult,
  workbook_inspect: workbookInspectResult,
  workbook_apply: workbookApplyResult,
  run_command: runCommandResult,
  folder_look: folderLookResult,
  folder_read: folderReadResult
}
export const maxResultChars = (kind: JobKind) => kind.startsWith('workbook_') ? SHEET_LIMITS.maxResultChars : kind === 'run_command' ? 9_000 : kind.startsWith('folder_') ? 16_000 : LIMITS.maxResultChars

/** How long a job may stay open. A command can legitimately run for minutes. */
export const jobTtlMs = (kind: JobKind) => kind === 'run_command' ? 6 * 60_000 : LIMITS.jobTtlMs

export const imageUploadSchema = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png']),
  imageBase64: z.string().min(8).max(1_100_000)
}).strict()

export const resultInputSchema = z.object({
  ok: z.boolean(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(300).optional(),
  cancelled: z.boolean().optional()
})

export const pollInputSchema = z.object({
  version: z.string().max(30).optional(),
  capabilities: z.array(short(40)).max(20).optional()
}).default({})

export const isOnline = (d: Pick<Device, 'lastSeenAt' | 'revokedAt'>, now: Date) =>
  !d.revokedAt && d.lastSeenAt !== null && now.getTime() - new Date(d.lastSeenAt).getTime() < LIMITS.onlineWindowMs
