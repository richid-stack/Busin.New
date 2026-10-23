import { InspectError } from '../inspect/browser'
import type { Screenshot, ScreenshotRequest } from '../inspect/browser'
import type { ScreenshotProvider } from '../inspect/screenshot'
import { isOnline, JOB_PERMISSION, OPEN_JOB, PERMISSION_LABEL } from './model'
import type { Device, Job, JobKind } from './model'
import type { BridgeStore } from './store'

/**
 * Takes screenshots with a connected computer's own browser instead of the cloud worker. It sees what the
 * worker cannot: a site running on that computer (localhost), or a page only that computer can open. The
 * computer must be online and must have allowed browser looks itself.
 */
export interface BridgeProviderOptions {
  store: Pick<BridgeStore, 'listDevices' | 'enqueue' | 'getJob' | 'cancelJob'>
  files: { get(id: string, userId: string): Promise<{ bytes: Uint8Array, mime: string } | null> }
  userId: string
  /** A computer's name, when the person named one. Otherwise the most recently active suitable one is used. */
  computer?: string
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
  timeoutMs?: number
}

export function chooseComputer(devices: Device[], now: Date, name?: string, kind: JobKind = 'browser_look'): Device {
  if (!devices.length) throw new InspectError('No computer is connected to OpenLobs. Add one on the Computers page first.')
  const pool = name ? devices.filter(d => d.name.toLowerCase() === name.trim().toLowerCase()) : devices
  if (!pool.length) throw new InspectError(`There is no connected computer named "${name!.slice(0, 60)}". Connected: ${devices.map(d => d.name).join(', ')}.`)
  const online = pool.filter(d => isOnline(d, now))
  if (!online.length) throw new InspectError(`${pool.length === 1 ? `"${pool[0]!.name}" is` : 'Your computers are'} offline right now. Start the Bridge on it and try again.`)
  const allowed = online.filter(d => d.capabilities.includes(kind))
  if (!allowed.length) {
    const needs = JOB_PERMISSION[kind] ?? 'browser'
    if (needs === 'browser') throw new InspectError(`"${online[0]!.name}" has not allowed looking at web pages. On that computer, run: npm run bridge -- allow browser`)
    throw new InspectError(`"${online[0]!.name}" has not been allowed to ${PERMISSION_LABEL[needs].toLowerCase()}. On that computer, run: bridge allow ${needs}${needs === 'excel' ? ' --folder "C:\\path\\to\\folder"' : ''}`)
  }
  return [...allowed].sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))[0]!
}

export function bridgeProvider(opts: BridgeProviderOptions): ScreenshotProvider {
  const now = opts.now ?? (() => new Date())
  const sleep = opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
  const pollMs = opts.pollMs ?? 700
  const timeoutMs = opts.timeoutMs ?? 50_000
  return {
    async capture(req: ScreenshotRequest, signal?: AbortSignal): Promise<Screenshot> {
      const device = chooseComputer(await opts.store.listDevices(opts.userId), now(), opts.computer)
      let job: Job
      try {
        job = await opts.store.enqueue(opts.userId, device.id, 'browser_look', { url: req.url, width: req.width, height: req.height, fullPage: req.fullPage === true, colorScheme: req.colorScheme })
      } catch (err: any) {
        throw new InspectError(String(err?.message || 'The computer could not be asked.').slice(0, 300))
      }
      const deadline = now().getTime() + timeoutMs
      for (;;) {
        if (signal?.aborted) { await opts.store.cancelJob(opts.userId, job.id).catch(() => {}); throw new InspectError('Cancelled.') }
        job = await opts.store.getJob(opts.userId, job.id)
        if (!OPEN_JOB.includes(job.status)) break
        if (now().getTime() >= deadline) {
          await opts.store.cancelJob(opts.userId, job.id).catch(() => {})
          throw new InspectError(`"${device.name}" did not answer in time. Check that the Bridge is running there.`)
        }
        await sleep(pollMs)
      }
      if (job.status === 'cancelled') throw new InspectError('The look was cancelled.')
      if (job.status === 'expired') throw new InspectError(`"${device.name}" did not pick up the request. Check that the Bridge is running there.`)
      if (job.status === 'failed') throw new InspectError(`"${device.name}" could not look at the page: ${job.error || 'unknown problem'}`.slice(0, 300))
      const r = (job.result ?? {}) as Record<string, any>
      const file = typeof r.fileId === 'string' ? await opts.files.get(r.fileId, opts.userId) : null
      if (!file || !file.bytes.length) throw new InspectError('The computer finished but its picture was not available.')
      return {
        bytes: file.bytes,
        mediaType: 'image/jpeg',
        width: Number(r.width) || 0,
        height: Number(r.height) || 0,
        url: String(r.finalUrl || req.url),
        title: String(r.title || '').slice(0, 200),
        facts: { status: typeof r.status === 'number' ? r.status : null, consoleErrors: Array.isArray(r.consoleErrors) ? r.consoleErrors.map(String).slice(0, 10) : [], failedRequests: Array.isArray(r.failedRequests) ? r.failedRequests.map(String).slice(0, 10) : [], computer: device.name }
      }
    }
  }
}

export interface RunJobOptions extends Pick<BridgeProviderOptions, 'store' | 'userId' | 'computer' | 'now' | 'sleep' | 'pollMs'> {
  kind: JobKind
  input: Record<string, unknown>
  timeoutMs: number
}

/** Asks a connected computer to do one job and waits for its answer. Errors are written for a person to read. */
export async function runBridgeJob(opts: RunJobOptions, signal?: AbortSignal): Promise<{ result: Record<string, unknown>, computer: string }> {
  const now = opts.now ?? (() => new Date())
  const sleep = opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
  const device = chooseComputer(await opts.store.listDevices(opts.userId), now(), opts.computer, opts.kind)
  let job: Job
  try { job = await opts.store.enqueue(opts.userId, device.id, opts.kind, opts.input) } catch (err: any) { throw new InspectError(String(err?.message || 'The computer could not be asked.').slice(0, 300)) }
  const deadline = now().getTime() + opts.timeoutMs
  for (;;) {
    if (signal?.aborted) { await opts.store.cancelJob(opts.userId, job.id).catch(() => {}); throw new InspectError('Cancelled.') }
    job = await opts.store.getJob(opts.userId, job.id)
    if (!OPEN_JOB.includes(job.status)) break
    if (now().getTime() >= deadline) {
      await opts.store.cancelJob(opts.userId, job.id).catch(() => {})
      throw new InspectError(`"${device.name}" did not answer in time. Check that the Bridge is running there.`)
    }
    await sleep(opts.pollMs ?? 700)
  }
  if (job.status === 'cancelled') throw new InspectError('The job was cancelled.')
  if (job.status === 'expired') throw new InspectError(`"${device.name}" did not pick up the request. Check that the Bridge is running there.`)
  if (job.status === 'failed') throw new InspectError(`"${device.name}" could not do it: ${job.error || 'unknown problem'}`.slice(0, 400))
  return { result: (job.result ?? {}) as Record<string, unknown>, computer: device.name }
}
