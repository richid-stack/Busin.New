import { DEFAULT_POWERS, POWERS, readPowers, type Powers } from '../../../shared/powers'

const SETTINGS = 'user_settings'

/** A person's powers. Never throws: when the record cannot be read, everything stays on (a read error must not break a chat). */
export async function getPowers(db: any, userId: string): Promise<Powers> {
  try {
    const doc = await db.collection(SETTINGS).doc(userId).get()
    return doc.exists ? readPowers(doc.data()?.powers) : { ...DEFAULT_POWERS }
  } catch {
    return { ...DEFAULT_POWERS }
  }
}

export async function setPowers(db: any, userId: string, patch: Partial<Powers>): Promise<Powers> {
  const ref = db.collection(SETTINGS).doc(userId)
  let result: Powers = { ...DEFAULT_POWERS }
  // The other settings kept in the same record (email switches, where the browser runs) are left as they are.
  await db.runTransaction(async (tx: any) => {
    const doc = await tx.get(ref)
    const data = doc.exists ? doc.data() : {}
    const next = readPowers(data?.powers)
    for (const p of POWERS) if (typeof patch[p] === 'boolean') next[p] = patch[p] as boolean
    result = next
    tx.set(ref, { ...data, userId, powers: next, updatedAt: new Date().toISOString() })
  })
  return result
}
