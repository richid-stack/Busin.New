import { randomUUID } from 'node:crypto'
import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { sanitizeForFirestore } from '../../utils/firebase'
import { assertNotDeleting } from '../account/tombstone'
import { ARTIFACT_LIMITS, KIND_FORMATS, parseSpec } from './model'
import type { ArtifactFormat, ArtifactKind, ArtifactSpec } from './model'

const META = 'artifacts'
const VERSIONS = 'artifact_versions'

/** A file OpenLobs made that the person can open, change one part at a time, and step back through. */
export interface ArtifactMeta {
  id: string
  userId: string
  kind: ArtifactKind
  format: ArtifactFormat
  title: string
  chatId: string | null
  /** The version being shown. Undo moves this back and redo forward; nothing is lost until a new change is made. */
  head: number
  /** The newest version there is. */
  latest: number
  /** The oldest version still kept. */
  oldest: number
  createdAt: string
  updatedAt: string
}

export interface ArtifactView extends ArtifactMeta {
  spec: ArtifactSpec
  canUndo: boolean
  canRedo: boolean
}

export class ArtifactGone extends Error {}

const versionId = (id: string, n: number) => `${id}__${n}`
const retention = () => new Date(Date.now() + ARTIFACT_LIMITS.retentionDays * 86_400_000)
const isId = (id: string) => /^[0-9a-f-]{36}$/.test(id)

function metaFrom(id: string, d: Record<string, any>): ArtifactMeta {
  return {
    id, userId: String(d.userId), kind: d.kind, format: d.format, title: String(d.title || ''), chatId: d.chatId ?? null,
    head: Number(d.head), latest: Number(d.latest), oldest: Number(d.oldest ?? 1), createdAt: String(d.createdAt), updatedAt: String(d.updatedAt)
  }
}

const expired = (d: Record<string, any>) => {
  const at = d.expiresAt?.toDate ? d.expiresAt.toDate() : d.expiresAt ? new Date(d.expiresAt) : null
  return !!at && at.getTime() <= Date.now()
}

/** The slice of Firestore the store needs, so it can be tried against the in-memory stand-in and the real emulator. */
export interface ArtifactDb { collection(name: string): any, batch(): any, runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> }

export function createArtifactStore(db: ArtifactDb) {
  /** Saves a brand new file as version 1. */
  async function createArtifact(userId: string, input: { kind: ArtifactKind, format: ArtifactFormat, title: string, spec: ArtifactSpec, chatId?: string | null }): Promise<ArtifactMeta> {
    await assertNotDeleting(userId, db)
    if (!KIND_FORMATS[input.kind].includes(input.format)) throw new Error('That format does not fit this kind of file.')
    const id = randomUUID()
    const now = new Date().toISOString()
    const expiresAt = retention()
    const meta = { userId, kind: input.kind, format: input.format, title: input.title, chatId: input.chatId ?? null, head: 1, latest: 1, oldest: 1, createdAt: now, updatedAt: now, expiresAt }
    const batch = db.batch()
    batch.set(db.collection(META).doc(id), sanitizeForFirestore(meta))
    batch.set(db.collection(VERSIONS).doc(versionId(id, 1)), sanitizeForFirestore({ userId, artifactId: id, n: 1, note: 'Created', spec: input.spec, createdAt: now, expiresAt }))
    await batch.commit()
    return metaFrom(id, meta)
  }

  const readVersion = async (id: string, n: number): Promise<ArtifactSpec | null> => {
    const snap = await db.collection(VERSIONS).doc(versionId(id, n)).get()
    return snap.exists ? (snap.data()!.spec as ArtifactSpec) : null
  }

  /** The file as it is at the moment (the version the person has stepped to), only for its owner. Anything else is "not found". */
  async function getArtifact(userId: string, id: string): Promise<ArtifactView | null> {
    if (!isId(id)) return null
    const snap = await db.collection(META).doc(id).get()
    const data = snap.exists ? snap.data()! : null
    if (!data || data.userId !== userId || expired(data)) return null
    const meta = metaFrom(id, data)
    const spec = await readVersion(id, meta.head)
    if (!spec) return null
    return { ...meta, spec, canUndo: meta.head > meta.oldest, canRedo: meta.head < meta.latest }
  }

  /**
   * Saves a changed spec as the next version. Changes made after stepping back replace the versions that were stepped
   * over (there is one line of history, not a tree). Only the newest {@link ARTIFACT_LIMITS.versions} are kept.
   * `expectedHead` makes a change fail when something else moved the file in the meantime.
   */
  async function saveVersion(userId: string, id: string, input: { spec: ArtifactSpec, note: string, title?: string, expectedHead?: number }): Promise<ArtifactView> {
    await assertNotDeleting(userId, db)
    if (!isId(id)) throw new ArtifactGone('This file was not found. It may have expired.')
    const metaRef = db.collection(META).doc(id)
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef)
      const data = snap.exists ? snap.data()! : null
      if (!data || data.userId !== userId || expired(data)) throw new ArtifactGone('This file was not found. It may have expired.')
      const meta = metaFrom(id, data)
      parseSpec(meta.kind, input.spec) // refuses a spec that does not fit this kind of file
      if (input.expectedHead !== undefined && input.expectedHead !== meta.head) throw new ArtifactGone('The file changed while you were working. Open it again and retry.')
      const next = meta.head + 1
      const now = new Date().toISOString()
      for (let n = meta.head + 1; n <= meta.latest; n++) tx.delete(db.collection(VERSIONS).doc(versionId(id, n)))
      const oldest = Math.max(meta.oldest, next - ARTIFACT_LIMITS.versions + 1)
      for (let n = meta.oldest; n < oldest; n++) tx.delete(db.collection(VERSIONS).doc(versionId(id, n)))
      const expiresAt = retention()
      tx.set(db.collection(VERSIONS).doc(versionId(id, next)), sanitizeForFirestore({ userId, artifactId: id, n: next, note: input.note.slice(0, 200), spec: input.spec, createdAt: now, expiresAt }))
      const title = input.title ?? meta.title
      tx.update(metaRef, sanitizeForFirestore({ head: next, latest: next, oldest, title, updatedAt: now, expiresAt }))
      return { ...meta, head: next, latest: next, oldest, title, updatedAt: now }
    })
    return { ...out, spec: input.spec, canUndo: out.head > out.oldest, canRedo: false }
  }

  /** Steps to a version that is still kept: undo goes back, redo goes forward. Nothing is deleted. */
  async function moveHead(userId: string, id: string, to: number): Promise<ArtifactView> {
    await assertNotDeleting(userId, db)
    if (!isId(id)) throw new ArtifactGone('This file was not found. It may have expired.')
    const metaRef = db.collection(META).doc(id)
    const meta = await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef)
      const data = snap.exists ? snap.data()! : null
      if (!data || data.userId !== userId || expired(data)) throw new ArtifactGone('This file was not found. It may have expired.')
      const m = metaFrom(id, data)
      if (!Number.isInteger(to) || to < m.oldest || to > m.latest) throw new ArtifactGone('That version is no longer kept.')
      tx.update(metaRef, { head: to, updatedAt: new Date().toISOString() })
      return { ...m, head: to }
    })
    const spec = await readVersion(id, to)
    if (!spec) throw new ArtifactGone('That version is no longer kept.')
    return { ...meta, spec, canUndo: to > meta.oldest, canRedo: to < meta.latest }
  }

  return { createArtifact, getArtifact, saveVersion, moveHead }
}

let shared: ReturnType<typeof createArtifactStore> | undefined
const real = () => (shared ??= createArtifactStore(getFirebaseDb() as unknown as ArtifactDb))
export const createArtifact = (...a: Parameters<ReturnType<typeof createArtifactStore>['createArtifact']>) => real().createArtifact(...a)
export const getArtifact = (...a: Parameters<ReturnType<typeof createArtifactStore>['getArtifact']>) => real().getArtifact(...a)
export const saveVersion = (...a: Parameters<ReturnType<typeof createArtifactStore>['saveVersion']>) => real().saveVersion(...a)
export const moveHead = (...a: Parameters<ReturnType<typeof createArtifactStore>['moveHead']>) => real().moveHead(...a)
