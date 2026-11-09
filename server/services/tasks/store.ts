import crypto from 'node:crypto'
import { assertNotDeleting } from '../account/tombstone'
import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { DEFAULT_CRITERION, FINAL_STATUSES, LIMITS, canTransition, isFinal } from './model'
import type { Artifact, Criterion, EventKind, ResumeNote, Task, TaskEvent, TaskInput, TaskStatus, Waiting } from './model'

const COLLECTION = 'tasks'
const LEASE_MS = 90_000

export class TaskError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'limit' | 'conflict' | 'invalid' = 'invalid') { super(message) }
}

export interface TaskDb { collection(name: string): any, runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> }

const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n)

function fromDoc(id: string, d: Record<string, any>): Task {
  return {
    id,
    userId: String(d.userId || ''),
    goal: String(d.goal || ''),
    status: d.status,
    criteria: Array.isArray(d.criteria) ? d.criteria : [],
    tools: Array.isArray(d.tools) ? d.tools : [],
    model: d.model ?? null,
    maxAttempts: d.maxAttempts ?? 2,
    maxSteps: d.maxSteps ?? 10,
    maxMinutes: d.maxMinutes ?? 6,
    attempts: d.attempts ?? 0,
    artifacts: Array.isArray(d.artifacts) ? d.artifacts : [],
    result: String(d.result || ''),
    outcome: String(d.outcome || ''),
    error: String(d.error || ''),
    eventCount: d.eventCount ?? 0,
    waiting: d.waiting ?? null,
    workedMs: d.workedMs ?? 0,
    resume: d.resume ?? null,
    scheduleId: d.scheduleId ?? null,
    leaseUntil: d.leaseUntil ?? null,
    leaseToken: d.leaseToken ?? null,
    createdAt: String(d.createdAt || ''),
    updatedAt: String(d.updatedAt || ''),
    startedAt: d.startedAt ?? null,
    finishedAt: d.finishedAt ?? null
  }
}

/** What the browser is told: the lease is a server detail. */
export function publicTask(t: Task): Omit<Task, 'leaseToken' | 'leaseUntil' | 'userId'> {
  const rest: Record<string, unknown> = { ...t }
  delete rest.leaseToken
  delete rest.leaseUntil
  delete rest.userId
  return rest as Omit<Task, 'leaseToken' | 'leaseUntil' | 'userId'>
}

export interface TaskPatch {
  status?: TaskStatus
  criteria?: Criterion[]
  attempts?: number
  artifacts?: Artifact[]
  result?: string
  outcome?: string
  error?: string
  waiting?: Waiting | null
  workedMs?: number
  resume?: ResumeNote | null
}

export function createTaskStore(db: TaskDb, opts: { now?: () => Date } = {}) {
  const now = () => (opts.now ?? (() => new Date()))()
  const ref = (id: string) => db.collection(COLLECTION).doc(id)

  async function mine(userId: string, id: string): Promise<Task | null> {
    const snap = await ref(id).get()
    if (!snap.exists) return null
    const t = fromDoc(snap.id, snap.data())
    return t.userId === userId ? t : null
  }

  return {
    async create(userId: string, input: TaskInput, opts: { scheduleId?: string } = {}): Promise<Task> {
      await assertNotDeleting(userId, db as any)
      const mineNow = (await db.collection(COLLECTION).where('userId', '==', userId).get()).docs.map((d: any) => fromDoc(d.id, d.data()))
      if (mineNow.filter((t: Task) => !isFinal(t.status) && t.status !== 'needs_review').length >= LIMITS.maxActive) {
        throw new TaskError(`You can have ${LIMITS.maxActive} tasks running or waiting at once. Wait for one to finish or cancel it.`, 'limit')
      }
      // Finished tasks make room for new ones, oldest first.
      if (mineNow.length >= LIMITS.maxKept) {
        const old = mineNow.filter((t: Task) => isFinal(t.status)).sort((a: Task, b: Task) => a.createdAt.localeCompare(b.createdAt)).slice(0, mineNow.length - LIMITS.maxKept + 1)
        if (old.length < mineNow.length - LIMITS.maxKept + 1) throw new TaskError('You have too many tasks. Cancel or finish some first.', 'limit')
        for (const t of old) await this.remove(userId, t.id)
      }
      const at = now().toISOString()
      const criteria: Criterion[] = (input.criteria.length ? input.criteria : [{ text: DEFAULT_CRITERION, kind: 'check' as const }]).map((c, i) => ({
        id: `c${i + 1}`, text: c.text, kind: c.kind, ...(c.format ? { format: c.format } : {}), ...(c.url ? { url: c.url } : {}), status: c.kind === 'manual' ? 'pending' : 'unchecked', evidence: ''
      }))
      const r = db.collection(COLLECTION).doc()
      const doc = {
        userId, goal: input.goal, status: 'queued', criteria, tools: input.tools, model: input.model, maxAttempts: input.maxAttempts, maxSteps: input.maxSteps, maxMinutes: input.maxMinutes,
        attempts: 0, artifacts: [], result: '', outcome: '', error: '', eventCount: 0, waiting: null, workedMs: 0, resume: null, scheduleId: opts.scheduleId ?? null, leaseUntil: null, leaseToken: null, createdAt: at, updatedAt: at, startedAt: null, finishedAt: null
      }
      await r.set(doc)
      const task = fromDoc(r.id, doc)
      await this.addEvent(task.id, 'created', opts.scheduleId ? 'Started by its schedule and waiting for a free worker.' : 'Task created and waiting for a free worker.')
      return { ...task, eventCount: 1 }
    },

    get: mine,

    async list(userId: string): Promise<Task[]> {
      const snap = await db.collection(COLLECTION).where('userId', '==', userId).get()
      return snap.docs.map((d: any) => fromDoc(d.id, d.data())).sort((a: Task, b: Task) => b.createdAt.localeCompare(a.createdAt))
    },

    async events(userId: string, id: string): Promise<TaskEvent[]> {
      if (!(await mine(userId, id))) throw new TaskError('Task not found.', 'not_found')
      const snap = await ref(id).collection('events').get()
      return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }) as TaskEvent).sort((a: TaskEvent, b: TaskEvent) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    },

    /** Adds a line to the task's log. The log is capped so one runaway task cannot fill the database; the cap never hides how it ended. */
    async addEvent(id: string, kind: EventKind, text: string, data?: Record<string, unknown>): Promise<void> {
      const important = kind === 'status' || kind === 'error' || kind === 'verify'
      const count: number = await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(id))
        if (!snap.exists) return -1
        const n = snap.data().eventCount ?? 0
        if (n >= LIMITS.maxEvents && !important) return -1
        tx.update(ref(id), { eventCount: n + 1 })
        return n
      })
      if (count < 0) return
      const at = now().toISOString()
      const eid = `${at.replace(/\D/g, '')}-${String(count).padStart(4, '0')}`
      await ref(id).collection('events').doc(eid).set({ at, kind, text: clip(text, 600), ...(data ? { data } : {}) })
    },

    /**
     * Takes the next task that is waiting, or one whose worker stopped answering (its lease ran out).
     * Returns null when there is nothing to do or another worker got there first.
     */
    async claimNext(): Promise<{ task: Task, lease: string } | null> {
      const t = now()
      const iso = t.toISOString()
      const queued = (await db.collection(COLLECTION).where('status', '==', 'queued').get()).docs
      const running = (await db.collection(COLLECTION).where('status', '==', 'running').where('leaseUntil', '<=', iso).get()).docs
      const verifying = (await db.collection(COLLECTION).where('status', '==', 'verifying').where('leaseUntil', '<=', iso).get()).docs
      const candidates = [...queued, ...running, ...verifying].sort((a: any, b: any) => String(a.data().createdAt).localeCompare(String(b.data().createdAt)))
      for (const c of candidates) {
        const lease = crypto.randomUUID()
        const got: Task | null = await db.runTransaction(async (tx: any) => {
          const snap = await tx.get(ref(c.id))
          if (!snap.exists) return null
          const d = snap.data()
          const free = d.status === 'queued' || ((d.status === 'running' || d.status === 'verifying') && (!d.leaseUntil || d.leaseUntil <= iso))
          if (!free) return null
          const patch = { status: 'running', leaseToken: lease, leaseUntil: new Date(t.getTime() + LEASE_MS).toISOString(), updatedAt: iso, startedAt: d.startedAt ?? iso }
          tx.update(ref(c.id), patch)
          return fromDoc(c.id, { ...d, ...patch })
        })
        if (got) return { task: got, lease }
      }
      return null
    },

    /** Applies a change only if this worker still holds the task, and only along a legal status path. */
    async update(id: string, lease: string, patch: TaskPatch): Promise<Task> {
      return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(id))
        if (!snap.exists) throw new TaskError('Task not found.', 'not_found')
        const cur = fromDoc(snap.id, snap.data())
        if (cur.leaseToken !== lease) throw new TaskError('This task was taken over by another worker or cancelled.', 'conflict')
        if (patch.status && !canTransition(cur.status, patch.status)) throw new TaskError(`A task cannot go from ${cur.status} to ${patch.status}.`, 'conflict')
        const at = now().toISOString()
        const next: Record<string, unknown> = { ...patch, updatedAt: at, leaseUntil: new Date(now().getTime() + LEASE_MS).toISOString() }
        // A task waiting for the person is held by nobody: whoever picks it up after they answer takes a fresh lease.
        if (patch.status === 'needs_you') { next.leaseUntil = null; next.leaseToken = null }
        if (patch.status && (isFinal(patch.status) || patch.status === 'needs_review')) { next.finishedAt = at; next.leaseUntil = null; next.leaseToken = null }
        if (typeof patch.result === 'string') next.result = clip(patch.result, 6000)
        if (typeof patch.outcome === 'string') next.outcome = clip(patch.outcome, 600)
        if (typeof patch.error === 'string') next.error = clip(patch.error, 600)
        tx.update(ref(id), next)
        return fromDoc(id, { ...snap.data(), ...next })
      })
    },

    /** True while this worker still holds the task and nobody cancelled it. */
    async stillMine(id: string, lease: string): Promise<boolean> {
      const snap = await ref(id).get()
      return snap.exists && snap.data().leaseToken === lease && !FINAL_STATUSES.includes(snap.data().status)
    },

    /** Cancels from outside a worker (the person pressed Stop). The worker notices on its next check. */
    async cancel(userId: string, id: string): Promise<Task> {
      return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(id))
        const cur = snap.exists ? fromDoc(snap.id, snap.data()) : null
        if (!cur || cur.userId !== userId) throw new TaskError('Task not found.', 'not_found')
        if (isFinal(cur.status)) throw new TaskError('This task has already finished.', 'conflict')
        const at = now().toISOString()
        const next = { status: 'cancelled', leaseToken: null, leaseUntil: null, updatedAt: at, finishedAt: at, outcome: 'Cancelled by you before it finished.' }
        tx.update(ref(id), next)
        return fromDoc(id, { ...snap.data(), ...next })
      })
    },

    /** The person answers a paused task: it goes back in the queue with what they decided. */
    async resume(userId: string, id: string, decision: 'approve' | 'decline' | 'continue'): Promise<Task> {
      return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(id))
        const cur = snap.exists ? fromDoc(snap.id, snap.data()) : null
        if (!cur || cur.userId !== userId) throw new TaskError('Task not found.', 'not_found')
        if (cur.status !== 'needs_you' || !cur.waiting) throw new TaskError('This task is not waiting for you.', 'conflict')
        const w = cur.waiting
        if (decision === 'approve' && w.reason !== 'approval') throw new TaskError('There is nothing here to approve: do what the page needs, then press Continue.', 'invalid')
        if (decision === 'continue' && w.reason !== 'person') throw new TaskError('Approve or decline the step first.', 'invalid')
        const resume: ResumeNote = decision === 'approve'
          ? { note: `The person approved this step and it may be done once: ${w.label}. The browser is still open on the page you were on: read it, then do exactly that step and carry on.`, approvedLabel: w.label }
          : decision === 'decline'
            ? { note: `The person declined this step: ${w.label}. Do not do it and do not look for another way to the same result. Finish what you can without it and say plainly that you stopped there.`, approvedLabel: null }
            : { note: `The person has dealt with what the page needed (${w.label}). The browser is still open on that page: read it first, then carry on.`, approvedLabel: null }
        const at = now().toISOString()
        const next = { status: 'queued', waiting: null, resume, leaseToken: null, leaseUntil: null, updatedAt: at }
        tx.update(ref(id), next)
        return fromDoc(id, { ...snap.data(), ...next })
      })
    },

    /** The wait ran out and the person never came back: the task stops, and says why. */
    async expireWaiting(userId: string, id: string): Promise<Task | null> {
      return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(id))
        const cur = snap.exists ? fromDoc(snap.id, snap.data()) : null
        if (!cur || cur.userId !== userId || cur.status !== 'needs_you') return null
        const at = now().toISOString()
        const outcome = `Stopped: it was waiting for you (${cur.waiting?.label || 'in the browser'}) and you did not come back within 30 minutes. Run it again when you can be there.`
        const next = { status: 'failed', waiting: null, resume: null, outcome, leaseToken: null, leaseUntil: null, updatedAt: at, finishedAt: at }
        tx.update(ref(id), next)
        return fromDoc(id, { ...snap.data(), ...next })
      })
    },

    /** The person confirms a task that could not be checked automatically. */
    async accept(userId: string, id: string): Promise<Task> {
      return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(id))
        const cur = snap.exists ? fromDoc(snap.id, snap.data()) : null
        if (!cur || cur.userId !== userId) throw new TaskError('Task not found.', 'not_found')
        if (cur.status !== 'needs_review') throw new TaskError('Only a task waiting for your review can be accepted.', 'conflict')
        const at = now().toISOString()
        const criteria = cur.criteria.map(c => (c.status === 'pending' || c.status === 'unsure') ? { ...c, status: 'met', evidence: `${c.evidence ? `${c.evidence} ` : ''}Confirmed by you.`.trim() } : c)
        const next = { status: 'done', criteria, outcome: 'Done. You confirmed the parts that could not be checked automatically.', updatedAt: at }
        tx.update(ref(id), next)
        return fromDoc(id, { ...snap.data(), ...next })
      })
    },

    async remove(userId: string, id: string): Promise<void> {
      const t = await mine(userId, id)
      if (!t) throw new TaskError('Task not found.', 'not_found')
      if (!isFinal(t.status)) throw new TaskError('Cancel the task before deleting it.', 'conflict')
      const ev = await ref(id).collection('events').get()
      for (const d of ev.docs) await d.ref.delete()
      await ref(id).delete()
    }
  }
}

export type TaskStore = ReturnType<typeof createTaskStore>

let shared: TaskStore | undefined
export const taskStore = () => (shared ??= createTaskStore(getFirebaseDb() as unknown as TaskDb))
