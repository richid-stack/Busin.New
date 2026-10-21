import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { assertNotDeleting } from '../account/tombstone'
import { MAX_MEMORIES, MemoryError, cleanMemoryText, sameMemory } from './memory'
import type { MemoryItem } from './memory'

const COLLECTION = 'memories'
const SETTINGS = 'memory_settings'

function fromDoc(id: string, data: Record<string, any>): MemoryItem {
  return {
    id,
    text: String(data.text || '').slice(0, 1000),
    source: data.source === 'assistant' ? 'assistant' : 'user',
    createdAt: String(data.createdAt || '')
  }
}

export async function listMemories(userId: string): Promise<MemoryItem[]> {
  const snap = await getFirebaseDb().collection(COLLECTION).where('userId', '==', userId).get()
  return snap.docs.map(d => fromDoc(d.id, d.data())).filter(m => m.text).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getMemory(id: string): Promise<(MemoryItem & { userId: string }) | null> {
  const doc = await getFirebaseDb().collection(COLLECTION).doc(id).get()
  return doc.exists ? { ...fromDoc(doc.id, doc.data()!), userId: String(doc.data()!.userId || '') } : null
}

const OFF = 'Memory is switched off, so nothing new is saved. Switch it on to add or change notes.'

/**
 * Saves one memory, or returns the one already there when the person said the same thing before. Switched off means
 * nothing is written. The duplicate and size checks and the write are one transaction, so simultaneous requests
 * cannot all pass against the same list.
 */
export async function addMemory(userId: string, rawText: string, source: MemoryItem['source']): Promise<{ item: MemoryItem, existed: boolean }> {
  await assertNotDeleting(userId)
  const text = cleanMemoryText(rawText)
  if (!(await isMemoryEnabled(userId))) throw new MemoryError(OFF)
  const db = getFirebaseDb()
  const ref = db.collection(COLLECTION).doc()
  const doc = { userId, text, source, createdAt: new Date().toISOString() }
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection(COLLECTION).where('userId', '==', userId))
    const existing = snap.docs.map(d => fromDoc(d.id, d.data())).filter(m => m.text)
    const same = existing.find(m => sameMemory(m.text, text))
    if (same) return { item: same, existed: true }
    if (existing.length >= MAX_MEMORIES) throw new MemoryError(`Memory is full (${MAX_MEMORIES} items). Delete some on the Memory page to make room.`)
    tx.set(ref, doc)
    return { item: fromDoc(ref.id, doc), existed: false }
  })
}

/** Changes one note. The new text follows the same rules as a new note, including not repeating another one. */
export async function updateMemory(userId: string, id: string, rawText: string): Promise<string> {
  const text = cleanMemoryText(rawText)
  if (!(await isMemoryEnabled(userId))) throw new MemoryError(OFF)
  const db = getFirebaseDb()
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection(COLLECTION).where('userId', '==', userId))
    const mine = snap.docs.find(d => d.id === id)
    if (!mine) throw new MemoryError('Memory not found.')
    if (snap.docs.some(d => d.id !== id && sameMemory(String(d.data().text || ''), text))) throw new MemoryError('You already have a note that says that.')
    tx.update(db.collection(COLLECTION).doc(id), { text })
  })
  return text
}

export async function deleteMemory(id: string): Promise<void> {
  await getFirebaseDb().collection(COLLECTION).doc(id).delete()
}

export async function clearMemories(userId: string): Promise<number> {
  const items = await listMemories(userId)
  await Promise.all(items.map(m => deleteMemory(m.id)))
  return items.length
}

/** On unless the person switched it off. */
export async function isMemoryEnabled(userId: string): Promise<boolean> {
  const doc = await getFirebaseDb().collection(SETTINGS).doc(userId).get()
  return !doc.exists || doc.data()!.enabled !== false
}

export async function setMemoryEnabled(userId: string, enabled: boolean): Promise<void> {
  await getFirebaseDb().collection(SETTINGS).doc(userId).set({ userId, enabled, updatedAt: new Date().toISOString() })
}
