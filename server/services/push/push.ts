import { createHash } from 'node:crypto'
import webpush from 'web-push'
import { open, seal } from '../../utils/secretBox'

const SUBS = 'push_subscriptions'
const CONFIG = 'system_config'
/** Devices one person can have alerts on. */
export const MAX_DEVICES = 10

export interface PushSubscriptionInput { endpoint: string, p256dh: string, auth: string, label?: string }
export interface StoredSubscription extends PushSubscriptionInput { id: string, userId: string, createdAt: string }
export interface PushPayload { title: string, body: string, /** Where tapping the alert goes, as a path inside the app. */ url: string, /** Alerts with the same tag replace each other. */ tag?: string }

export class PushError extends Error {}

/** A push address is a long secret-looking https URL on the browser maker's push service. Anything else is refused. */
export function validEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && !u.username && !u.password && endpoint.length <= 1000 && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname) && u.hostname.includes('.')
  } catch { return false }
}

const idFor = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 40)

export interface VapidKeys { publicKey: string, privateKey: string }

/**
 * The keys that sign alerts. VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY win when both are set. Otherwise a pair is made once and
 * kept in the database with the private half encrypted, so there is nothing to set up and nothing to paste anywhere.
 * Changing the keys later turns every device's alerts off (browsers tie a subscription to its key), so they are made once.
 */
export async function getVapidKeys(db: any, env: NodeJS.ProcessEnv = process.env): Promise<VapidKeys> {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
  const ref = db.collection(CONFIG).doc('vapid')
  return await db.runTransaction(async (tx: any) => {
    const doc = await tx.get(ref)
    if (doc.exists) {
      const d = doc.data()
      return { publicKey: d.publicKey as string, privateKey: open(d.sealedPrivateKey as string, 'vapid') }
    }
    const fresh = webpush.generateVAPIDKeys()
    tx.set(ref, { publicKey: fresh.publicKey, sealedPrivateKey: seal(fresh.privateKey, 'vapid'), createdAt: new Date().toISOString() })
    return fresh
  })
}

export async function saveSubscription(db: any, userId: string, input: PushSubscriptionInput, now = new Date()): Promise<StoredSubscription> {
  if (!validEndpoint(input.endpoint)) throw new PushError('That device address is not accepted.')
  if (!input.p256dh || !input.auth || input.p256dh.length > 200 || input.auth.length > 100) throw new PushError('That device sent incomplete details.')
  const id = idFor(input.endpoint)
  const ref = db.collection(SUBS).doc(id)
  return await db.runTransaction(async (tx: any) => {
    const doc = await tx.get(ref)
    // The same device signing in as someone else takes the alerts with it: a subscription belongs to one person.
    if (!doc.exists) {
      const mine = await tx.get(db.collection(SUBS).where('userId', '==', userId))
      if (mine.size >= MAX_DEVICES) throw new PushError(`You can have alerts on up to ${MAX_DEVICES} devices. Turn one off first.`)
    }
    const stored: StoredSubscription = { id, userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, ...(input.label ? { label: input.label.slice(0, 60) } : {}), createdAt: doc.exists ? doc.data().createdAt : now.toISOString() }
    tx.set(ref, stored)
    return stored
  })
}

/** Removes one device's alerts. Only the owner can remove it. */
export async function removeSubscription(db: any, userId: string, endpoint: string): Promise<boolean> {
  const ref = db.collection(SUBS).doc(idFor(endpoint))
  const doc = await ref.get()
  if (!doc.exists || doc.data().userId !== userId) return false
  await ref.delete()
  return true
}

export async function listSubscriptions(db: any, userId: string): Promise<StoredSubscription[]> {
  const snap = await db.collection(SUBS).where('userId', '==', userId).get()
  return (snap.docs as any[]).map(d => d.data() as StoredSubscription)
}

export interface PushDeps {
  db: any
  /** Sends one alert. Throws an error with `statusCode` when the device refuses. */
  send?: (sub: { endpoint: string, keys: { p256dh: string, auth: string } }, body: string, keys: VapidKeys) => Promise<unknown>
  subject?: string
  env?: NodeJS.ProcessEnv
}

const defaultSend: NonNullable<PushDeps['send']> = (sub, body, keys) =>
  webpush.sendNotification(sub, body, { vapidDetails: { subject: process.env.PUSH_SUBJECT || (process.env.APP_URL?.startsWith('https://') ? process.env.APP_URL : 'mailto:alerts@openlobs.app'), publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 3600, urgency: 'high' })

/**
 * Sends an alert to every device the person turned alerts on for. A device that says the address is gone (404 or 410)
 * is forgotten. Never throws: an alert that cannot be sent must not break the work that raised it. Returns how many arrived.
 */
export async function sendPushToUser(deps: PushDeps, userId: string, payload: PushPayload): Promise<number> {
  try {
    const subs = await listSubscriptions(deps.db, userId)
    if (!subs.length) return 0
    const keys = await getVapidKeys(deps.db, deps.env)
    const send = deps.send ?? defaultSend
    const body = JSON.stringify({ title: payload.title.slice(0, 80), body: payload.body.slice(0, 200), url: payload.url, ...(payload.tag ? { tag: payload.tag } : {}) })
    let delivered = 0
    await Promise.all(subs.map(async (s) => {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, keys)
        delivered++
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) await deps.db.collection(SUBS).doc(s.id).delete().catch(() => {})
        else console.warn('[push] not delivered:', err?.statusCode ?? err?.message)
      }
    }))
    return delivered
  } catch (err: any) {
    console.warn('[push] alerts unavailable:', err?.message)
    return 0
  }
}
