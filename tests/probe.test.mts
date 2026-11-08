import { createFakeFirestore } from './fakeFirestore'
import { createTaskScheduleStore } from '../server/services/tasks/schedules'
import { createTaskStore } from '../server/services/tasks/store'
import { taskInputSchema } from '../server/services/tasks/model'
const within = async <T>(label: string, fn: () => Promise<T>, ms = 12000): Promise<T | undefined> => {
  const t0 = Date.now()
  try {
    const v = await Promise.race([(async () => fn())(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT after ${ms}ms`)), ms))])
    console.log(`PASS ${label} (${Date.now() - t0}ms)`)
    return v as T
  } catch (e: any) { console.log(`FAIL ${label}: ${String(e.message).slice(0, 300)} (${Date.now() - t0}ms)`); return undefined }
}
const db: any = createFakeFirestore()
await within('plain set', () => db.collection('probe').doc('a').set({ x: 1 }))
await within('plain get', () => db.collection('probe').doc('a').get())
await within('where query', () => db.collection('probe').where('x', '==', 1).get())
await within('transaction update', () => db.runTransaction(async (tx: any) => { const s = await tx.get(db.collection('probe').doc('a')); tx.update(db.collection('probe').doc('a'), { x: s.data().x + 1 }) }))
await within('set with undefined inside', () => db.collection('probe').doc('b').set({ x: 1, y: undefined }))
await within('set with nested undefined', () => db.collection('probe').doc('c').set({ x: { y: undefined, z: [1] } }))
const st = createTaskStore(db, { now: () => new Date('2026-10-30T10:00:00Z') })
const input = taskInputSchema.parse({ goal: 'Check the news every morning please', tools: ['web'] })
console.log('input', JSON.stringify(input).slice(0, 300))
await within('task store create', () => st.create('alice', input))

const { createReef } = await import('../server/services/reef/reef')
const reef = createReef(db, { now: () => new Date('2026-10-26T08:00:00Z') })
await within('reef profile create', () => reef.profiles.create('u-ama', { handle: '@Ama', name: 'Ama Boateng', bio: 'Runs a small shop.', place: 'Accra' }))
const sch = createTaskScheduleStore(db, { now: () => new Date('2026-10-26T08:00:00Z') })
const { parseSchedule } = await import('../server/services/tasks/schedules') as any
console.log('schedule exports', Object.keys(await import('../server/services/tasks/schedules')).join(','))
