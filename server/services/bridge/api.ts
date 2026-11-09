import { LIMITS, isJobKind, pairInputSchema, pollInputSchema, resultInputSchema } from './model'
import type { Device } from './model'
import { BridgeError } from './store'
import type { BridgeStore } from './store'

/** The logic behind the Bridge's own endpoints, apart from the web plumbing, so it can be tested end to end. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const invalidCode = 'That code is not valid or has expired. Make a new one in OpenLobs.'

export async function pairDevice(store: BridgeStore, raw: unknown) {
  const parsed = pairInputSchema.safeParse(raw)
  if (!parsed.success) throw new ApiError(400, invalidCode)
  try {
    return await store.redeemPairing(parsed.data.code, { name: parsed.data.name, platform: parsed.data.platform, version: parsed.data.version })
  } catch (err) {
    if (err instanceof BridgeError) throw new ApiError(400, err.message)
    throw err
  }
}

export interface PollOptions { waitMs?: number, checkMs?: number, now?: () => number }

/**
 * "Anything for me?" Waits up to `waitMs` when there is nothing. Only job kinds the server knows are sent.
 * If the person disconnects the computer while it waits, the answer says so and the Bridge stops.
 */
export async function pollForJobs(store: BridgeStore, device: Device, token: string, raw: unknown, opts: PollOptions = {}) {
  const body = pollInputSchema.safeParse(raw ?? {})
  const now = opts.now ?? Date.now
  await store.touch(device, body.success ? { version: body.data.version, capabilities: body.data.capabilities } : {})
  const deadline = now() + (opts.waitMs ?? LIMITS.pollWaitMs)
  for (;;) {
    const { jobs, cancel } = await store.claimJobs(device.id)
    const sendable = jobs.filter(j => isJobKind(j.kind))
    if (sendable.length || cancel.length || now() >= deadline) return { jobs: sendable.map(j => ({ id: j.id, kind: j.kind, input: j.input })), cancel }
    await store.waitForWake(device.id, Math.max(1, Math.min(opts.checkMs ?? LIMITS.pollCheckMs, deadline - now())))
    if (!(await store.authenticate(token))) return { jobs: [], cancel: [], revoked: true }
  }
}

export async function reportJob(store: BridgeStore, device: Device, jobId: string, raw: unknown) {
  const parsed = resultInputSchema.safeParse(raw)
  if (!parsed.success) throw new ApiError(400, 'Invalid result.')
  try {
    const job = await store.reportResult(device.id, jobId, parsed.data)
    await store.addEvent(device.id, 'job', `"${job.kind}" ${job.status === 'done' ? 'finished' : job.status}.`)
    return { status: job.status }
  } catch (err) {
    if (err instanceof BridgeError) throw new ApiError(err.code === 'not_found' ? 404 : 409, err.message)
    throw err
  }
}
