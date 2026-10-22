export type Platform = 'windows' | 'mac' | 'linux' | 'other'
export type JobStatus = 'queued' | 'sent' | 'done' | 'failed' | 'cancelled' | 'expired'

export interface ComputerItem {
  id: string
  name: string
  platform: Platform
  bridgeVersion: string
  capabilities: string[]
  pairedAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  online: boolean
}

export interface BridgeJobItem {
  id: string
  deviceId: string
  kind: string
  status: JobStatus
  result: Record<string, unknown> | null
  error: string
  createdAt: string
  finishedAt: string | null
}

export interface PairingCode {
  code: string
  expiresAt: string
}

export const PLATFORM_LABEL: Record<Platform, string> = { windows: 'Windows', mac: 'Mac', linux: 'Linux', other: 'Computer' }
export const OPEN_JOB: JobStatus[] = ['queued', 'sent']
