import { randomUUID } from 'node:crypto'

/** Files OpenLobs creates for a user. Each one belongs to its creator and expires. */
export const FILE_COLLECTION = 'generated_files'
export const FILE_RETENTION_DAYS = 30
export const MAX_FILE_BYTES = 700_000 // a Firestore document holds 1 MiB in total

export interface StoredFile {
  id: string
  userId: string
  name: string
  mime: string
  size: number
  bytes: Uint8Array
  expiresAt: Date
}

/** The slice of Firestore this store needs, so it can be tested without a database. */
export interface FileDb {
  collection(name: string): {
    doc(id: string): {
      set(data: Record<string, unknown>): Promise<unknown>
      get(): Promise<{ exists: boolean, data(): Record<string, any> | undefined }>
      delete(): Promise<unknown>
    }
  }
}

/** A name safe to show and to send in a download header. */
export function safeFileName(raw: string, extension: string): string {
  const base = raw
    .normalize('NFKD')
    .replace(/[^\w .-]+/g, '')
    .replace(/\.+/g, '.')
    .replace(/^[. ]+|[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || 'document'
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`
}

export function createFileStore(db: FileDb, now: () => Date = () => new Date()) {
  return {
    async save(input: { userId: string, name: string, mime: string, bytes: Uint8Array }): Promise<{ id: string, expiresAt: Date }> {
      if (input.bytes.length > MAX_FILE_BYTES) throw new Error('The file is too large to save.')
      const id = randomUUID()
      const createdAt = now()
      const expiresAt = new Date(createdAt.getTime() + FILE_RETENTION_DAYS * 86_400_000)
      await db.collection(FILE_COLLECTION).doc(id).set({
        userId: input.userId,
        name: input.name,
        mime: input.mime,
        size: input.bytes.length,
        data: Buffer.from(input.bytes),
        createdAt,
        expiresAt
      })
      return { id, expiresAt }
    },

    /** The file, only when `userId` created it and it has not expired. Anything else looks like "not found". */
    async get(id: string, userId: string): Promise<StoredFile | null> {
      if (!/^[0-9a-f-]{36}$/.test(id)) return null
      const ref = db.collection(FILE_COLLECTION).doc(id)
      const snap = await ref.get()
      const data = snap.exists ? snap.data() : undefined
      if (!data || data.userId !== userId) return null
      const expiresAt: Date = data.expiresAt?.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt)
      if (expiresAt.getTime() <= now().getTime()) {
        ref.delete().catch(() => {})
        return null
      }
      const raw = data.data
      const bytes = raw instanceof Uint8Array ? new Uint8Array(raw) : raw?.toUint8Array ? raw.toUint8Array() : null
      if (!bytes) return null
      return { id, userId, name: String(data.name), mime: String(data.mime), size: bytes.length, bytes, expiresAt }
    }
  }
}
