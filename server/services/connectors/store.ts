import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { open, seal } from '../../utils/secretBox'
import { ConnectorError, unitsOf } from './runtime'
import type { ActionDef, ConnectorDef } from './types'

const CREDS = 'connector_credentials'
const USAGE = 'connector_usage'
const AUDIT = 'connector_audit'

type Db = any

const credId = (userId: string, provider: string) => `${userId}__${provider}`
/** The key is derived from the person too, so a stored secret copied onto another account is unreadable. */
const purpose = (userId: string, provider: string) => `connector:${provider}:${userId}`

export interface ConnectionView { connected: boolean, hint: string, connectedAt: string | null }

/** Checks what a person pasted. Only fields the connector declares are accepted, each in the expected shape. */
export function cleanCredentials(def: ConnectorDef, input: Record<string, unknown>): Record<string, string> {
  const clean: Record<string, string> = {}
  const known = new Set(def.fields.map(f => f.id))
  const extra = Object.keys(input ?? {}).filter(k => !known.has(k))
  if (extra.length) throw new ConnectorError('Unexpected fields were sent.')
  for (const f of def.fields) {
    const v = typeof input?.[f.id] === 'string' ? (input[f.id] as string).trim() : ''
    if (!v) throw new ConnectorError(`${f.label} is required.`)
    if (v.length > 300 || (f.pattern && !f.pattern.test(v))) throw new ConnectorError(`That ${f.label.toLowerCase()} does not look right. ${f.help ?? ''}`.trim())
    clean[f.id] = v
  }
  return clean
}

/** Stores a person's own key, sealed. */
export async function saveCredentials(db: Db, userId: string, def: ConnectorDef, input: Record<string, unknown>, now = new Date()): Promise<ConnectionView> {
  const clean = cleanCredentials(def, input)
  const first = def.fields.find(f => f.secret) ?? def.fields[0]!
  const hint = `…${clean[first.id]!.slice(-4)}`
  await db.collection(CREDS).doc(credId(userId, def.provider)).set({
    userId, provider: def.provider, sealed: seal(JSON.stringify(clean), purpose(userId, def.provider)), hint, connectedAt: now.toISOString()
  })
  return { connected: true, hint, connectedAt: now.toISOString() }
}

export async function getCredentials(db: Db, userId: string, provider: string): Promise<Record<string, string> | null> {
  const doc = await db.collection(CREDS).doc(credId(userId, provider)).get()
  if (!doc.exists) return null
  const d = doc.data()
  if (d.userId !== userId) return null
  try {
    return JSON.parse(open(String(d.sealed), purpose(userId, provider)))
  } catch {
    return null
  }
}

export async function deleteCredentials(db: Db, userId: string, provider: string): Promise<void> {
  await db.collection(CREDS).doc(credId(userId, provider)).delete()
}

/** Which connectors the person has set up, without any secret. */
export async function connectionViews(db: Db, userId: string): Promise<Map<string, ConnectionView>> {
  const snap = await db.collection(CREDS).where('userId', '==', userId).get()
  return new Map((snap.docs as any[]).map(d => [String(d.data().provider), { connected: true, hint: String(d.data().hint ?? ''), connectedAt: d.data().connectedAt ?? null }]))
}

/**
 * Takes `units` from the person's daily allowance for a costly action, or refuses. One transaction, so
 * several requests at once cannot get past the limit together.
 */
export async function takeDailyAllowance(db: Db, userId: string, def: ConnectorDef, action: ActionDef, values: Record<string, unknown>, now = new Date()): Promise<{ units: number, release: () => Promise<void> }> {
  const units = unitsOf(values)
  if (!action.dailyLimit) return { units, release: async () => {} }
  const ref = db.collection(USAGE).doc(`${userId}__${def.provider}__${action.id}__${now.toISOString().slice(0, 10)}`)
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const used = snap.exists ? Number(snap.data().count ?? 0) : 0
    if (used + units > action.dailyLimit!) {
      throw new ConnectorError(`That would go over today's limit for ${action.name} (${action.dailyLimit} a day, ${used} used). It resets at midnight, Ghana time.`, 'limit')
    }
    tx.set(ref, { userId, provider: def.provider, actionId: action.id, day: now.toISOString().slice(0, 10), count: used + units })
  })
  return {
    units,
    release: async () => {
      await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref)
        if (snap.exists) tx.set(ref, { ...snap.data(), count: Math.max(0, Number(snap.data().count ?? 0) - units) })
      }).catch(() => {})
    }
  }
}

/** A short record of what was done with a connected service, for the person's own export. */
export async function audit(db: Db, userId: string, def: ConnectorDef, action: ActionDef, ok: boolean, units: number, note: string, now = new Date()) {
  await db.collection(AUDIT).doc().set({ userId, provider: def.provider, actionId: action.id, effect: action.effect, ok, units, note: note.slice(0, 200), at: now.toISOString() })
    .catch((err: any) => console.warn('[connectors] audit not written:', err?.message))
}

export const defaultDb = () => getFirebaseDb()
