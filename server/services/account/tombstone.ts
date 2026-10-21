import { getFirebaseDb } from '../../utils/firebaseAdmin'

/**
 * A marker left when a person asks for their account to be deleted. It holds only the id and the time.
 * Anything that would write data for a person (a workflow run still in flight, a late payment) checks it
 * first, so nothing is re-created after the erase has swept past.
 */
export const DELETIONS = 'account_deletions'

export async function markDeleting(db: any, userId: string, now = new Date()): Promise<void> {
  await db.collection(DELETIONS).doc(userId).set({ userId, startedAt: now.toISOString() })
}

export async function isDeleting(userId: string | null | undefined, db: any = getFirebaseDb()): Promise<boolean> {
  if (!userId) return false
  const snap = await db.collection(DELETIONS).doc(userId).get()
  return Boolean(snap.exists)
}

/** Lifts the marker when a deletion stopped before any data was removed, so the account carries on normally. */
export async function clearDeleting(db: any, userId: string): Promise<void> {
  await db.collection(DELETIONS).doc(userId).delete().catch(() => {})
}
