import type { TaskDb } from '../tasks/store'
import { LIMITS, ReefError, cleanText, projectIdOf } from './model'
import type { ReportReason } from './model'
import type { PostStore } from './posts'
import type { ProjectStore } from './projects'

/**
 * Reports and the review queue. Anyone signed in can report a project or a post. When several different
 * people report the same thing it is hidden until someone has looked, and it lands in the queue that the
 * people who run The Reef work through. They can put it back, or take it down.
 */

export const REPORTS = 'reef_reports'

export type TargetType = 'project' | 'post'

export interface QueueItem {
  targetType: TargetType
  /** "owner/name" for a project, the post id for a post. */
  targetId: string
  reports: number
  reasons: ReportReason[]
  notes: string[]
  hidden: boolean
  flagged: boolean
  firstReportedAt: string
}

/** Who may work the queue and hand out badges: the emails or ids in REEF_ADMINS (comma separated). */
export function isReefAdmin(user: { id: string, email?: string } | null | undefined, env: string | undefined = process.env.REEF_ADMINS): boolean {
  if (!user || !env) return false
  const list = env.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return list.includes(user.id.toLowerCase()) || Boolean(user.email && list.includes(user.email.toLowerCase()))
}

type Row = { targetType: TargetType, targetId: string, reason: ReportReason, note: string, createdAt: string }

export function createModeration(db: TaskDb, stores: { projects: ProjectStore, posts: PostStore }, opts: { now?: () => Date } = {}) {
  const now = () => (opts.now ?? (() => new Date()))().toISOString()
  const reports = () => db.collection(REPORTS)

  const resolveTarget = async (type: TargetType, targetId: string) => {
    if (type === 'project') {
      const [owner, name] = targetId.split('/')
      if (!owner || !name) throw new ReefError('That project does not exist.', 'not_found')
      const p = await stores.projects.load(projectIdOf(owner, name))
      if (!p) throw new ReefError('That project does not exist.', 'not_found')
      return { ownerId: p.userId, key: p.id, hidden: p.hidden, flagged: p.scan.verdict === 'review', setHidden: (h: boolean) => stores.projects.setHidden(p.id, h) }
    }
    const p = await stores.posts.load(targetId)
    if (!p) throw new ReefError('That post does not exist.', 'not_found')
    return { ownerId: p.userId, key: p.id, hidden: p.hidden, flagged: p.flagged, setHidden: (h: boolean) => stores.posts.setHidden(p.id, h) }
  }

  const moderation = {
    async report(userId: string, type: TargetType, targetId: string, reason: ReportReason, note: string): Promise<{ hidden: boolean }> {
      const t = await resolveTarget(type, targetId)
      if (t.ownerId === userId) throw new ReefError('You cannot report your own work. Remove it instead.', 'conflict')
      await reports().doc(`${type}__${t.key}__${userId}`).set({ userId, targetType: type, targetId, targetKey: `${type}__${t.key}`, reason, note: cleanText(note).slice(0, 300), open: true, createdAt: now() })
      const open = (await reports().where('targetKey', '==', `${type}__${t.key}`).where('open', '==', true).get()).docs.map((d: any) => d.data())
      const reporters = new Set(open.map((d: any) => d.userId))
      const hide = reporters.size >= LIMITS.reportsToHide
      if (hide && !t.hidden) await t.setHidden(true)
      return { hidden: hide || t.hidden }
    },

    /** What needs a human: reported things, and posts the scan wanted looked at. Most reported first. */
    async queue(): Promise<QueueItem[]> {
      const open: Row[] = (await reports().where('open', '==', true).limit(500).get()).docs.map((d: any) => d.data())
      const grouped = new Map<string, QueueItem>()
      for (const r of open) {
        const key = `${r.targetType}__${r.targetId}`
        const cur: QueueItem = grouped.get(key) ?? { targetType: r.targetType, targetId: r.targetId, reports: 0, reasons: [], notes: [], hidden: false, flagged: false, firstReportedAt: r.createdAt }
        cur.reports += 1
        if (!cur.reasons.includes(r.reason)) cur.reasons.push(r.reason)
        if (r.note) cur.notes.push(r.note)
        if (r.createdAt < cur.firstReportedAt) cur.firstReportedAt = r.createdAt
        grouped.set(key, cur)
      }
      const items = [...grouped.values()]
      for (const item of items) {
        const t = await resolveTarget(item.targetType, item.targetId).catch(() => null)
        item.hidden = t?.hidden ?? false
        item.flagged = t?.flagged ?? false
      }
      return items.sort((a, b) => b.reports - a.reports)
    },

    /** "restore" puts it back and closes the reports. "remove" takes it down for good. */
    async resolve(type: TargetType, targetId: string, action: 'restore' | 'remove'): Promise<void> {
      const t = await resolveTarget(type, targetId)
      const open = (await reports().where('targetKey', '==', `${type}__${t.key}`).get()).docs as any[]
      if (action === 'restore') await t.setHidden(false)
      else if (type === 'project') {
        const [owner, name] = targetId.split('/')
        await stores.projects.remove(t.ownerId, owner!, name!)
      } else await stores.posts.remove(t.ownerId, targetId)
      await Promise.all(open.map(d => d.ref.update({ open: false, closedAt: now(), outcome: action })))
    },

    /** For account deletion: reports a person made stop being about them. */
    async forgetUser(userId: string): Promise<void> {
      const mine = (await reports().where('userId', '==', userId).get()).docs as any[]
      await Promise.all(mine.map(d => d.ref.delete()))
    }
  }
  return moderation
}

export type Moderation = ReturnType<typeof createModeration>
