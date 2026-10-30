import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { BROWSER_LIMITS } from './model'
import type { BrowserService } from './service'

/**
 * A browser page that is waiting for the person (a sign-in, a code, an OK) is "held": kept open for up to half an hour.
 * This is the record of that wait. A timer looks at the records: if the person has not looked at the page for a minute
 * it emails them once, and when the wait runs out it closes the page and tells whatever was waiting (a task) that it is over.
 */

export type HoldReason = 'approval' | 'person'
export interface Hold {
  /** The browser session this wait belongs to. */
  key: string
  userId: string
  kind: 'chat' | 'task'
  /** The chat id or task id, to link back to. */
  ref: string
  reason: HoldReason
  /** What is needed, in a few words ("Click “Place order” on shop.example.com"). */
  label: string
  createdAt: string
  expiresAt: string
  notifiedAt: string | null
}

const COLLECTION = 'browser_holds'
/** Nobody has looked at the page for this long: the person is away. */
export const AWAY_AFTER_MS = 60_000

export interface HoldDb { collection(name: string): any }
const docId = (key: string) => key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200)
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n)

export function createHoldStore(db: HoldDb, opts: { now?: () => Date } = {}) {
  const now = () => (opts.now ?? (() => new Date()))()
  const ref = (key: string) => db.collection(COLLECTION).doc(docId(key))
  return {
    async raise(h: Pick<Hold, 'key' | 'userId' | 'kind' | 'ref' | 'reason' | 'label'>): Promise<Hold> {
      const at = now()
      const hold: Hold = { ...h, label: clip(h.label, 200), createdAt: at.toISOString(), expiresAt: new Date(at.getTime() + BROWSER_LIMITS.holdMs).toISOString(), notifiedAt: null }
      await ref(h.key).set(hold)
      return hold
    },
    async get(key: string): Promise<Hold | null> {
      const snap = await ref(key).get()
      return snap.exists ? snap.data() as Hold : null
    },
    async clear(key: string): Promise<void> {
      await ref(key).delete().catch(() => {})
    },
    async markNotified(key: string): Promise<void> {
      await ref(key).update({ notifiedAt: now().toISOString() }).catch(() => {})
    },
    async all(limit = 200): Promise<Hold[]> {
      const snap = await db.collection(COLLECTION).get()
      return (snap.docs as any[]).map(d => d.data() as Hold).slice(0, limit)
    }
  }
}
export type HoldStore = ReturnType<typeof createHoldStore>
let shared: HoldStore | undefined
export const holdStore = () => (shared ??= createHoldStore(getFirebaseDb() as unknown as HoldDb))

/** What the app tells the browser and the records when a page starts waiting. Failing to do either must never break the step. */
export async function startWait(deps: { service: BrowserService, store: HoldStore }, h: Pick<Hold, 'key' | 'userId' | 'kind' | 'ref' | 'reason' | 'label'>): Promise<void> {
  await deps.service.hold(h.key, BROWSER_LIMITS.holdMs).catch(() => {})
  await deps.store.raise(h).catch(err => console.warn('[browser-hold] could not record the wait:', err?.message))
}

export interface HoldPassDeps {
  store: HoldStore
  service: BrowserService | null
  now?: () => Date
  /** Emails the person; true when it was sent. */
  notify: (hold: Hold) => Promise<boolean>
  /** The wait ran out: tell whatever was waiting. */
  onExpired: (hold: Hold) => Promise<unknown>
}
export interface HoldPassSummary { checked: number, emailed: number, expired: number, cleared: number }

/** One timer pass over the waits. Safe to run from several places at once: emails are sent at most once per wait. */
export async function processHolds(deps: HoldPassDeps): Promise<HoldPassSummary> {
  const now = (deps.now ?? (() => new Date()))().getTime()
  const summary: HoldPassSummary = { checked: 0, emailed: 0, expired: 0, cleared: 0 }
  for (const hold of await deps.store.all()) {
    summary.checked++
    try {
      if (new Date(hold.expiresAt).getTime() <= now) {
        await deps.service?.close(hold.key).catch(() => {})
        await deps.onExpired(hold).catch(err => console.warn('[browser-hold] expiry handler failed:', err?.message))
        await deps.store.clear(hold.key)
        summary.expired++
        continue
      }
      if (hold.notifiedAt || now - new Date(hold.createdAt).getTime() < AWAY_AFTER_MS || !deps.service) continue
      const status = await deps.service.status(hold.key).catch(() => undefined)
      // The page is gone (closed, or the worker restarted): there is nothing left to wait for.
      if (status === null) { await deps.store.clear(hold.key); summary.cleared++; continue }
      if (status === undefined) continue
      // Somebody is looking at it right now: they are here, no email needed (yet).
      if (status.viewedAgoMs !== null && status.viewedAgoMs < AWAY_AFTER_MS) continue
      if (await deps.notify(hold)) { await deps.store.markNotified(hold.key); summary.emailed++ }
    } catch (err) {
      console.warn('[browser-hold] pass failed for one wait:', (err as Error)?.message)
    }
  }
  return summary
}
