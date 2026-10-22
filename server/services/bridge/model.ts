import { z } from 'zod'

/**
 * OpenLobs Bridge: a small program on a person's own computer that OpenLobs can ask to do approved things.
 * The server never sends a command to run. It sends a named job from a short, fixed list; the Bridge checks
 * that list itself and refuses anything else. Today the list has one harmless job (a ping).
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
  maxResultChars: 4000,
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
export const JOB_KINDS = ['ping'] as const
export type JobKind = typeof JOB_KINDS[number]

export const isJobKind = (k: unknown): k is JobKind => (JOB_KINDS as readonly string[]).includes(String(k))

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
