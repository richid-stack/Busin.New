import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { assertNotDeleting } from '../account/tombstone'
import type { ListedModel } from '../../../shared/modelProviders'

const COLLECTION = 'model_connections'

export const MODEL_LIMITS = { connections: 20, listed: 600, enabled: 60, manual: 20 }

export class ModelConnectionError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

/** What is stored for one person and one provider. The key is only ever stored sealed. */
export interface ModelConnection {
  id: string
  userId: string
  providerId: string
  /** Only set when it differs from the provider's own address. */
  baseUrl: string
  sealedKey: string
  /** What the provider said it offers when last asked. */
  models: ListedModel[]
  /** The ids that appear in the picker. */
  enabled: string[]
  /** Ids the person typed in themselves, for services that do not list their models. */
  manual: string[]
  fetchedAt: string
  createdAt: string
  updatedAt: string
}

export const connectionId = (userId: string, providerId: string) => `${userId}__${providerId}`

function fromDoc(id: string, d: Record<string, any>): ModelConnection {
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return {
    id,
    userId: String(d.userId || ''),
    providerId: String(d.providerId || ''),
    baseUrl: String(d.baseUrl || ''),
    sealedKey: String(d.sealedKey || ''),
    models: Array.isArray(d.models) ? d.models.filter((m: any) => m && typeof m.id === 'string') : [],
    enabled: strings(d.enabled),
    manual: strings(d.manual),
    fetchedAt: String(d.fetchedAt || ''),
    createdAt: String(d.createdAt || ''),
    updatedAt: String(d.updatedAt || '')
  }
}

export async function listConnections(userId: string): Promise<ModelConnection[]> {
  const snap = await getFirebaseDb().collection(COLLECTION).where('userId', '==', userId).get()
  return snap.docs.map(d => fromDoc(d.id, d.data()))
}

export async function getConnection(userId: string, providerId: string): Promise<ModelConnection | null> {
  const snap = await getFirebaseDb().collection(COLLECTION).doc(connectionId(userId, providerId)).get()
  return snap.exists && snap.data()!.userId === userId ? fromDoc(snap.id, snap.data()!) : null
}

/** Models switched on by default the first time: all of a short list, otherwise the newest few. */
export function defaultEnabled(models: ListedModel[]): string[] {
  return models.slice(0, models.length <= 12 ? models.length : 8).map(m => m.id)
}

/**
 * Saves a key and the models it unlocked. Connecting again replaces the key and the list; what the person had
 * switched on stays on for models that still exist.
 */
export async function saveConnection(userId: string, input: { providerId: string, baseUrl: string, sealedKey: string, models: ListedModel[] }): Promise<ModelConnection> {
  await assertNotDeleting(userId)
  const db = getFirebaseDb()
  const ref = db.collection(COLLECTION).doc(connectionId(userId, input.providerId))
  const now = new Date().toISOString()
  return await db.runTransaction(async (tx) => {
    const mine = await tx.get(db.collection(COLLECTION).where('userId', '==', userId))
    const current = mine.docs.find(d => d.id === ref.id)
    if (!current && mine.docs.length >= MODEL_LIMITS.connections) throw new ModelConnectionError(`You can connect up to ${MODEL_LIMITS.connections} providers. Remove one to add another.`, 409)
    const before = current ? fromDoc(current.id, current.data()) : null
    const known = new Set([...input.models.map(m => m.id), ...(before?.manual ?? [])])
    const enabled = before ? before.enabled.filter(id => known.has(id)) : defaultEnabled(input.models)
    const doc = {
      userId, providerId: input.providerId, baseUrl: input.baseUrl, sealedKey: input.sealedKey,
      models: input.models.slice(0, MODEL_LIMITS.listed), enabled, manual: before?.manual ?? [],
      fetchedAt: now, createdAt: before?.createdAt || now, updatedAt: now
    }
    tx.set(ref, doc)
    return fromDoc(ref.id, doc)
  })
}

/** Which models appear in the picker, and which typed-in ones exist. Ids the provider never listed are refused unless typed in. */
export async function setSelection(userId: string, providerId: string, selection: { enabled: string[], manual: string[] }): Promise<ModelConnection> {
  const db = getFirebaseDb()
  const ref = db.collection(COLLECTION).doc(connectionId(userId, providerId))
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data()!.userId !== userId) throw new ModelConnectionError('Connect this provider first.', 404)
    const before = fromDoc(snap.id, snap.data()!)
    const manual = [...new Set(selection.manual)].slice(0, MODEL_LIMITS.manual)
    if (selection.manual.length > MODEL_LIMITS.manual) throw new ModelConnectionError(`You can add up to ${MODEL_LIMITS.manual} models by name.`)
    const known = new Set([...before.models.map(m => m.id), ...manual])
    const enabled = [...new Set(selection.enabled)]
    const unknown = enabled.find(id => !known.has(id))
    if (unknown) throw new ModelConnectionError(`"${unknown}" is not one of this provider's models. Get the models again, or add it by name.`)
    if (enabled.length > MODEL_LIMITS.enabled) throw new ModelConnectionError(`Switch on up to ${MODEL_LIMITS.enabled} models in total. Fewer keeps the picker easy to use.`)
    const patch = { enabled, manual, updatedAt: new Date().toISOString() }
    tx.update(ref, patch)
    return fromDoc(snap.id, { ...snap.data()!, ...patch })
  })
}

export async function deleteConnection(userId: string, providerId: string): Promise<boolean> {
  const ref = getFirebaseDb().collection(COLLECTION).doc(connectionId(userId, providerId))
  const snap = await ref.get()
  if (!snap.exists || snap.data()!.userId !== userId) return false
  await ref.delete()
  return true
}
