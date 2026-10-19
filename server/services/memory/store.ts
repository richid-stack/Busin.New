import { getFirebaseDb } from '../../utils/firebaseAdmin'
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

/** Saves one memory, or returns the one already there when the person said the same thing before. */
export async function addMemory(userId: string, rawText: string, source: MemoryItem['source']): Promise<{ item: MemoryItem, existed: boolean }> {
  const text = cleanMemoryText(rawText)
  const existing = await listMemories(userId)
  const same = existing.find(m => sameMemory(m.text, text))
  if (same) return { item: same, existed: true }
  if (existing.length >= MAX_MEMORIES) throw new MemoryError(`Memory is full (${MAX_MEMORIES} items). Delete some on the Memory page to make room.`)
  const ref = getFirebaseDb().collection(COLLECTION).doc()
  const doc = { userId, text, source, createdAt: new Date().toISOString() }
  await ref.set(doc)
  return { item: fromDoc(ref.id, doc), existed: false }
}

export async function updateMemory(id: string, rawText: string): Promise<string> {
  const text = cleanMemoryText(rawText)
  await getFirebaseDb().collection(COLLECTION).doc(id).update({ text })
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
