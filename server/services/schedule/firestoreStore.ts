import { getFirebaseDb, toWorkflow } from '../../utils/firebase'
import { outcomePatch } from './plan'
import type { DueWorkflow, ScheduleStore } from './tick'

const COLLECTION = 'workflows'

/** The schedule store on Firestore. `scheduleNextRunAt` is an ISO string, so a plain range query finds due workflows with no extra index. */
export function createFirestoreScheduleStore(): ScheduleStore {
  const db = () => getFirebaseDb()
  return {
    async findDue(nowIso, limit) {
      const snap = await db().collection(COLLECTION).where('scheduleNextRunAt', '<=', nowIso).orderBy('scheduleNextRunAt').limit(limit).get()
      return snap.docs.map(d => ({ id: d.id, nextRunAt: String(d.get('scheduleNextRunAt')) }))
    },

    async claim(id, expectedNextRunAt, decide) {
      return await db().runTransaction(async (tx) => {
        const ref = db().collection(COLLECTION).doc(id)
        const snap = await tx.get(ref)
        const data = snap.data()
        if (!snap.exists || !data || data.scheduleNextRunAt !== expectedNextRunAt) return null
        const workflow = toWorkflow(id, data) as unknown as DueWorkflow
        const { patch, run } = decide(workflow)
        tx.update(ref, patch)
        return { workflow, run }
      })
    },

    async recordOutcome(id, failed) {
      return await db().runTransaction(async (tx) => {
        const ref = db().collection(COLLECTION).doc(id)
        const snap = await tx.get(ref)
        if (!snap.exists) return { paused: false }
        const { patch, paused } = outcomePatch(Number(snap.get('scheduleFailures')) || 0, failed)
        tx.update(ref, patch)
        return { paused }
      })
    }
  }
}
