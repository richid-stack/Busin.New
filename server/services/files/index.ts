import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { createFileStore } from './store'
import type { FileDb } from './store'

export * from './store'

/** The store backed by the real database. Created on first use. */
let shared: ReturnType<typeof createFileStore> | undefined
export const fileStore = () => (shared ??= createFileStore(getFirebaseDb() as unknown as FileDb))
