import crypto from 'node:crypto'
import { assertNotDeleting } from '../account/tombstone'
import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { JOB_PERMISSION, LIMITS, OPEN_JOB, PAIRING_ALPHABET, PERMISSION_LABEL, TOKEN_PREFIX, RESULT_SCHEMA, isJobKind, maxResultChars, parseJobInput } from './model'
import type { Device, DeviceEvent, EventKind, Job, JobKind, Platform } from './model'

export class BridgeError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'limit' | 'invalid' | 'conflict' | 'unauthorized' = 'invalid') { super(message) }
}

export interface BridgeDb { collection(name: string): any, runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> }

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n)

function deviceFrom(id: string, d: Record<string, any>): Device & { tokenHash: string | null, lastSeenWrittenAt?: number } {
  return {
    id, userId: String(d.userId || ''), name: String(d.name || 'Computer'), platform: d.platform || 'other', bridgeVersion: String(d.bridgeVersion || ''),
    capabilities: Array.isArray(d.capabilities) ? d.capabilities : [], pairedAt: String(d.pairedAt || ''), lastSeenAt: d.lastSeenAt ?? null, revokedAt: d.revokedAt ?? null,
    tokenHash: d.tokenHash ?? null
  }
}
export function publicDevice(d: Device): Device {
  const out: Record<string, unknown> = { ...d }
  delete out.tokenHash
  delete out.userId
  return out as unknown as Device
}
function jobFrom(id: string, d: Record<string, any>): Job {
  return {
    id, userId: String(d.userId || ''), deviceId: String(d.deviceId || ''), kind: d.kind, status: d.status, input: d.input ?? {}, result: d.result ?? null, error: String(d.error || ''), fileId: typeof d.fileId === 'string' ? d.fileId : null,
    cancelAcked: d.cancelAcked === true, createdAt: String(d.createdAt || ''), sentAt: d.sentAt ?? null, finishedAt: d.finishedAt ?? null, expiresAt: String(d.expiresAt || '')
  }
}
export function publicJob(j: Job): Omit<Job, 'userId'> {
  const out: Record<string, unknown> = { ...j }
  delete out.userId
  return out as unknown as Omit<Job, 'userId'>
}

/** Letters and digits that cannot be mistaken for each other, so a code can be read out or typed. */
export function newPairingCode(random: (n: number) => Buffer = crypto.randomBytes): string {
  const bytes = random(8)
  return Array.from(bytes, b => PAIRING_ALPHABET[b % PAIRING_ALPHABET.length]).join('')
}

export function createBridgeStore(db: BridgeDb, opts: { now?: () => Date, random?: (n: number) => Buffer } = {}) {
  const now = () => (opts.now ?? (() => new Date()))()
  const random = opts.random ?? crypto.randomBytes
  const devRef = (id: string) => db.collection('devices').doc(id)
  const jobRef = (id: string) => db.collection('bridge_jobs').doc(id)
  /** Wakes a device's waiting poll the moment a job for it is made on this server. */
  const waiters = new Map<string, () => void>()

  async function ownedDevice(userId: string, id: string) {
    const snap = await devRef(id).get()
    const d = snap.exists ? deviceFrom(snap.id, snap.data()) : null
    if (!d || d.userId !== userId) throw new BridgeError('Computer not found.', 'not_found')
    return d
  }

  const self = {
    /** Wakes the poll waiting for this device, if it is waiting on this server. */
    wake(deviceId: string) { waiters.get(deviceId)?.() },

    /** Resolves when `wake` is called for the device or the time runs out. */
    waitForWake(deviceId: string, ms: number): Promise<void> {
      return new Promise((resolve) => {
        const t = setTimeout(() => { waiters.delete(deviceId); resolve() }, ms)
        waiters.set(deviceId, () => { clearTimeout(t); waiters.delete(deviceId); resolve() })
      })
    },

    // ---- Pairing ----
    async createPairing(userId: string): Promise<{ code: string, expiresAt: string }> {
      await assertNotDeleting(userId, db as any)
      const devices = (await db.collection('devices').where('userId', '==', userId).get()).docs.map((d: any) => deviceFrom(d.id, d.data())).filter((d: Device) => !d.revokedAt)
      if (devices.length >= LIMITS.maxDevices) throw new BridgeError(`You can connect up to ${LIMITS.maxDevices} computers. Disconnect one to add another.`, 'limit')
      // One open code per person: a new one replaces the old.
      for (const old of (await db.collection('bridge_pairings').where('userId', '==', userId).get()).docs) await old.ref.delete()
      const code = newPairingCode(random)
      const expiresAt = new Date(now().getTime() + LIMITS.pairingTtlMs).toISOString()
      await db.collection('bridge_pairings').doc(sha(code)).set({ userId, expiresAt, createdAt: now().toISOString() })
      return { code, expiresAt }
    },

    /** Trades a code for a device token, once. The token is shown here and never stored in the clear. */
    async redeemPairing(code: string, info: { name: string, platform: Platform, version: string }): Promise<{ deviceId: string, token: string }> {
      const ref = db.collection('bridge_pairings').doc(sha(code))
      const token = `${TOKEN_PREFIX}${random(32).toString('base64url')}`
      const at = now().toISOString()
      const devId = db.collection('devices').doc().id
      await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref)
        // The same message for every reason, so a guess learns nothing.
        if (!snap.exists || snap.data().expiresAt <= at) throw new BridgeError('That code is not valid or has expired. Make a new one in OpenLobs.', 'invalid')
        const owner = snap.data().userId
        tx.delete(ref)
        tx.set(devRef(devId), { userId: owner, name: info.name, platform: info.platform, bridgeVersion: info.version, capabilities: [], pairedAt: at, lastSeenAt: at, revokedAt: null, tokenHash: sha(token) })
      })
      await self.addEvent(devId, 'paired', `Paired as "${info.name}" (${info.platform}, Bridge ${info.version}).`)
      return { deviceId: devId, token }
    },

    // ---- Devices ----
    async authenticate(token: string): Promise<Device | null> {
      if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null
      const snap = await db.collection('devices').where('tokenHash', '==', sha(token)).get()
      const doc = snap.docs[0]
      if (!doc) return null
      const d = deviceFrom(doc.id, doc.data())
      if (d.revokedAt) return null
      return d
    },

    /** Notes that the device just called in. Written at most every 30 seconds so waiting costs little. */
    async touch(device: Device, patch: { version?: string, capabilities?: string[] } = {}): Promise<void> {
      const last = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0
      const changed = (patch.version && patch.version !== device.bridgeVersion) || (patch.capabilities && patch.capabilities.join() !== device.capabilities.join())
      if (!changed && now().getTime() - last < LIMITS.lastSeenWriteMs) return
      await devRef(device.id).update({ lastSeenAt: now().toISOString(), ...(patch.version ? { bridgeVersion: patch.version } : {}), ...(patch.capabilities ? { capabilities: patch.capabilities } : {}) }).catch(() => {})
    },

    async listDevices(userId: string): Promise<Device[]> {
      const snap = await db.collection('devices').where('userId', '==', userId).get()
      return snap.docs.map((d: any) => deviceFrom(d.id, d.data())).filter((d: Device) => !d.revokedAt).sort((a: Device, b: Device) => a.pairedAt.localeCompare(b.pairedAt))
    },

    getDevice: ownedDevice,

    /** Disconnects a computer. Its token stops working at once and its open jobs are cancelled. */
    async revoke(userId: string, id: string): Promise<void> {
      await ownedDevice(userId, id)
      await devRef(id).update({ revokedAt: now().toISOString(), tokenHash: null })
      const open = (await db.collection('bridge_jobs').where('deviceId', '==', id).get()).docs.filter((d: any) => OPEN_JOB.includes(d.data().status))
      for (const j of open) await j.ref.update({ status: 'cancelled', finishedAt: now().toISOString(), cancelAcked: true })
      await self.addEvent(id, 'revoked', 'Disconnected from OpenLobs.')
      self.wake(id)
    },

    // ---- Jobs ----
    async enqueue(userId: string, deviceId: string, kind: JobKind, input: Record<string, unknown> = {}): Promise<Job> {
      if (!isJobKind(kind)) throw new BridgeError('That kind of job is not supported.', 'invalid')
      await assertNotDeleting(userId, db as any)
      const device = await ownedDevice(userId, deviceId)
      if (device.revokedAt) throw new BridgeError('This computer was disconnected.', 'conflict')
      // The person decides on the computer itself what it may be asked to do. Asking for more than that is refused here, and again there.
      const needs = JOB_PERMISSION[kind]
      if (needs && !device.capabilities.includes(kind)) {
        throw new BridgeError(`This computer has not been allowed to "${PERMISSION_LABEL[needs].toLowerCase()}". On that computer, run: bridge allow ${needs}${needs === 'excel' ? ' --folder "C:\\path\\to\\folder"' : ''}`, 'conflict')
      }
      try { input = parseJobInput(kind, input) } catch (err: any) { throw new BridgeError(err.message, 'invalid') }
      const mine = (await db.collection('bridge_jobs').where('deviceId', '==', deviceId).get()).docs.map((d: any) => jobFrom(d.id, d.data()))
      const stale = mine.filter((j: Job) => OPEN_JOB.includes(j.status) && j.expiresAt <= now().toISOString())
      for (const j of stale) await jobRef(j.id).update({ status: 'expired', finishedAt: now().toISOString() })
      if (mine.filter((j: Job) => OPEN_JOB.includes(j.status) && !stale.some((s: Job) => s.id === j.id)).length >= LIMITS.maxOpenJobs) throw new BridgeError('This computer already has jobs waiting. Wait for them to finish.', 'limit')
      // Keep a short history: the oldest finished jobs make room.
      const finished = mine.filter((j: Job) => !OPEN_JOB.includes(j.status)).sort((a: Job, b: Job) => a.createdAt.localeCompare(b.createdAt))
      for (const j of finished.slice(0, Math.max(0, finished.length - LIMITS.keptJobs + 1))) await jobRef(j.id).delete()
      const at = now()
      const r = db.collection('bridge_jobs').doc()
      const doc = { userId, deviceId, kind, status: 'queued', input, result: null, error: '', fileId: null, cancelAcked: false, createdAt: at.toISOString(), sentAt: null, finishedAt: null, expiresAt: new Date(at.getTime() + LIMITS.jobTtlMs).toISOString() }
      await r.set(doc)
      await self.addEvent(deviceId, 'job', `Asked to run "${kind}".`)
      self.wake(deviceId)
      return jobFrom(r.id, doc)
    },

    /** Hands the device its waiting jobs (and any it must stop). Each job is handed out once. */
    async claimJobs(deviceId: string): Promise<{ jobs: Job[], cancel: string[] }> {
      const iso = now().toISOString()
      const all = (await db.collection('bridge_jobs').where('deviceId', '==', deviceId).get()).docs.map((d: any) => jobFrom(d.id, d.data()))
      const jobs: Job[] = []
      for (const j of all.filter((x: Job) => x.status === 'queued').sort((a: Job, b: Job) => a.createdAt.localeCompare(b.createdAt))) {
        const got: Job | null = await db.runTransaction(async (tx: any) => {
          const snap = await tx.get(jobRef(j.id))
          if (!snap.exists || snap.data().status !== 'queued') return null
          if (snap.data().expiresAt <= iso) { tx.update(jobRef(j.id), { status: 'expired', finishedAt: iso }); return null }
          tx.update(jobRef(j.id), { status: 'sent', sentAt: iso })
          return jobFrom(j.id, { ...snap.data(), status: 'sent', sentAt: iso })
        })
        if (got) jobs.push(got)
      }
      const cancel = all.filter((x: Job) => x.status === 'cancelled' && !x.cancelAcked && x.sentAt).map((x: Job) => x.id)
      return { jobs, cancel }
    },

    /** The device reports how a job went. Only the device it was sent to may do so, and only once. */
    async reportResult(deviceId: string, jobId: string, report: { ok: boolean, result?: Record<string, unknown>, error?: string, cancelled?: boolean }): Promise<Job> {
      return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(jobRef(jobId))
        const cur = snap.exists ? jobFrom(snap.id, snap.data()) : null
        if (!cur || cur.deviceId !== deviceId) throw new BridgeError('Job not found.', 'not_found')
        const at = now().toISOString()
        if (cur.status === 'cancelled') { tx.update(jobRef(jobId), { cancelAcked: true }); return { ...cur, cancelAcked: true } }
        if (cur.status !== 'sent') throw new BridgeError('That job is not waiting for a result.', 'conflict')
        let patch: Record<string, unknown>
        if (report.cancelled) patch = { status: 'cancelled', finishedAt: at, cancelAcked: true }
        else if (!report.ok) patch = { status: 'failed', finishedAt: at, error: clip(report.error || 'The computer reported a failure.', 300) }
        else {
          // Whatever a computer sends back is checked against what that job is allowed to return, and is only ever shown as text.
          const parsed = RESULT_SCHEMA[cur.kind].safeParse(report.result ?? {})
          if (!parsed.success) patch = { status: 'failed', finishedAt: at, error: 'The computer sent back something that was not in the expected form.' }
          else if (JSON.stringify(parsed.data).length > maxResultChars(cur.kind)) patch = { status: 'failed', finishedAt: at, error: 'The result was too large.' }
          else if (cur.kind === 'browser_look' && !cur.fileId) patch = { status: 'failed', finishedAt: at, error: 'The computer did not send a picture.' }
          // The picture is the one this computer uploaded for this job, taken from the job itself and not from the report.
          else patch = { status: 'done', finishedAt: at, result: cur.kind === 'browser_look' ? { ...(parsed.data as Record<string, unknown>), fileId: cur.fileId } : parsed.data as Record<string, unknown> }
        }
        tx.update(jobRef(jobId), patch)
        return { ...cur, ...patch } as Job
      })
    },

    /** Notes the picture a computer uploaded for its job. One picture per job, and only while the job is running on that computer. */
    async attachFile(deviceId: string, jobId: string, fileId: string): Promise<void> {
      await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(jobRef(jobId))
        const cur = snap.exists ? jobFrom(snap.id, snap.data()) : null
        if (!cur || cur.deviceId !== deviceId || cur.kind !== 'browser_look') throw new BridgeError('Job not found.', 'not_found')
        if (cur.status !== 'sent') throw new BridgeError('That job is not waiting for a result.', 'conflict')
        if (cur.fileId) throw new BridgeError('That job already has its picture.', 'conflict')
        tx.update(jobRef(jobId), { fileId })
      })
    },

    /** The job a device is about to upload for, checked before any bytes are stored. */
    async jobForUpload(deviceId: string, jobId: string): Promise<Job> {
      const snap = await jobRef(jobId).get()
      const cur = snap.exists ? jobFrom(snap.id, snap.data()) : null
      if (!cur || cur.deviceId !== deviceId || cur.kind !== 'browser_look') throw new BridgeError('Job not found.', 'not_found')
      if (cur.status !== 'sent') throw new BridgeError('That job is not waiting for a result.', 'conflict')
      if (cur.fileId) throw new BridgeError('That job already has its picture.', 'conflict')
      return cur
    },

    async cancelJob(userId: string, jobId: string): Promise<Job> {
      return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(jobRef(jobId))
        const cur = snap.exists ? jobFrom(snap.id, snap.data()) : null
        if (!cur || cur.userId !== userId) throw new BridgeError('Job not found.', 'not_found')
        if (!OPEN_JOB.includes(cur.status)) throw new BridgeError('That job has already finished.', 'conflict')
        const patch = { status: 'cancelled', finishedAt: now().toISOString(), cancelAcked: cur.status === 'queued' }
        tx.update(jobRef(jobId), patch)
        return { ...cur, ...patch } as Job
      })
    },

    async getJob(userId: string, jobId: string): Promise<Job> {
      const snap = await jobRef(jobId).get()
      const j = snap.exists ? jobFrom(snap.id, snap.data()) : null
      if (!j || j.userId !== userId) throw new BridgeError('Job not found.', 'not_found')
      if (OPEN_JOB.includes(j.status) && j.expiresAt <= now().toISOString()) {
        await jobRef(jobId).update({ status: 'expired', finishedAt: now().toISOString() })
        return { ...j, status: 'expired', finishedAt: now().toISOString() }
      }
      return j
    },

    async listJobs(userId: string, deviceId: string): Promise<Job[]> {
      await ownedDevice(userId, deviceId)
      const snap = await db.collection('bridge_jobs').where('deviceId', '==', deviceId).get()
      return snap.docs.map((d: any) => jobFrom(d.id, d.data())).filter((j: Job) => j.userId === userId).sort((a: Job, b: Job) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10)
    },

    // ---- Activity ----
    async addEvent(deviceId: string, kind: EventKind, text: string): Promise<void> {
      const count: number = await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(devRef(deviceId))
        if (!snap.exists) return -1
        const n = snap.data().eventCount ?? 0
        if (n >= LIMITS.maxEvents && kind !== 'revoked') return -1
        tx.update(devRef(deviceId), { eventCount: n + 1 })
        return n
      })
      if (count < 0) return
      const at = now().toISOString()
      await devRef(deviceId).collection('events').doc(`${at.replace(/\D/g, '')}-${String(count).padStart(4, '0')}`).set({ at, kind, text: clip(text, 300) })
    },

    async events(userId: string, deviceId: string): Promise<DeviceEvent[]> {
      await ownedDevice(userId, deviceId)
      const snap = await devRef(deviceId).collection('events').get()
      return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }) as DeviceEvent).sort((a: DeviceEvent, b: DeviceEvent) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    }
  }
  return self
}

export type BridgeStore = ReturnType<typeof createBridgeStore>
let shared: BridgeStore | undefined
export const bridgeStore = () => (shared ??= createBridgeStore(getFirebaseDb() as unknown as BridgeDb))
