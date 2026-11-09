import type { TaskDb } from '../tasks/store'
import { LIMITS } from './model'

/**
 * Alerts: a short list of what other people did that touches you (followed you, starred a project, liked
 * or answered a post). One document per thing that happened, named so that doing it twice (like, unlike,
 * like) is still one alert.
 */

export const ALERTS = 'reef_alerts'

export type AlertType = 'follow' | 'star' | 'like' | 'reply' | 'answer' | 'fork' | 'accepted'

export interface Alert {
  id: string
  type: AlertType
  actor: { handle: string, name: string, verified: boolean, official: boolean }
  /** What it is about: a project ("ama/shop-assistant"), a post id, or a profile handle. */
  targetType: 'project' | 'post' | 'profile'
  targetId: string
  preview: string
  read: boolean
  createdAt: string
}

interface NewAlert { to: string, type: AlertType, actor: Alert['actor'] & { userId?: string }, targetType: Alert['targetType'], targetId: string, preview: string, unique?: string }

/** Records an alert for someone. Never throws: an alert that cannot be saved must not stop the like or follow it is about. */
export async function notify(db: TaskDb, a: NewAlert, at: string): Promise<void> {
  try {
    const id = `${a.type}__${a.actor.handle}__${a.unique ?? a.targetId}`
    // Only what a page shows: never the actor's account id.
    const actor = { handle: a.actor.handle, name: a.actor.name, verified: a.actor.verified, official: a.actor.official }
    await db.collection(ALERTS).doc(`${a.to}__${id}`).set({ userId: a.to, type: a.type, actor, targetType: a.targetType, targetId: a.targetId, preview: a.preview.slice(0, 120), read: false, createdAt: at })
  } catch (err) {
    console.warn('[reef] could not save an alert:', (err as Error)?.message)
  }
}

export function createAlertStore(db: TaskDb) {
  const col = () => db.collection(ALERTS)
  return {
    async list(userId: string, max = 40): Promise<Alert[]> {
      const snap = await col().where('userId', '==', userId).orderBy('createdAt', 'desc').limit(max).get()
      return (snap.docs as any[]).map(d => ({ id: d.id, ...d.data() })).map((d: any) => ({ id: d.id.slice(userId.length + 2), type: d.type, actor: d.actor, targetType: d.targetType, targetId: d.targetId, preview: d.preview || '', read: d.read === true, createdAt: d.createdAt }))
    },

    async unreadCount(userId: string): Promise<number> {
      const snap = await col().where('userId', '==', userId).where('read', '==', false).limit(LIMITS.page * 5).get()
      return snap.size
    },

    async markAllRead(userId: string): Promise<void> {
      const snap = await col().where('userId', '==', userId).where('read', '==', false).limit(200).get()
      await Promise.all((snap.docs as any[]).map(d => d.ref.update({ read: true })))
    }
  }
}

export type AlertStore = ReturnType<typeof createAlertStore>
